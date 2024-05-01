import * as cp from 'child_process'
import {outputChannel} from '../extension'
import { RelativePattern } from 'vscode';

export class InstanceType {
    name: string;
    description: string;
    cpus: number;
    gpus: number;

    constructor(name: string, description: string, cpus: number, gpus: number) {
        this.name = name;
        this.description = description;
        this.cpus = cpus;
        this.gpus = gpus;
    }
}

export class Quota {
    Basic: {limit: number, used: number} = {limit: 0, used: 0};
    Standard: {limit: number, used: number} = {limit: 0, used: 0};
    Premium: {limit: number, used: number} = {limit: 0, used: 0};
}

export class InstanceSeries {
    id: string;
    name: string;
    quota: Quota = new Quota();
    limit: {limit: number, used: number} | undefined = undefined;
    instanceTypes: InstanceType[] = [];

    constructor(id: string, name:string) {
        this.id = id;
        this.name = name;
    }
}

export class VirtualCluster {
    id: string;
    subscriptionId: string;
    resourceGroup: string;
    name: string;
    location: string;
    instanceSeries: InstanceSeries[] = [];
    defaultWorkspace: Workspace | undefined = undefined;

    constructor(id: string, subscriptionId: string, resourceGroup: string, name: string, location: string) {
        this.id = id;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
        this.name = name;
        this.location = location;
    }
}

export class Workspace {
    id: string;
    name: string;
    subscriptionId: string;
    resourceGroup: string;

    constructor(id: string, name: string, subscriptionId: string, resourceGroup: string) {
        this.id = id;
        this.name = name;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
    }
}

export class Image {
    name: string;
    description: string;

    constructor(name: string, description: string) {
        this.name = name;
        this.description = description;
    }
}

export namespace  REST {

    export enum RESTMethod {
        GET = 'GET',
        POST = 'POST',
        PUT = 'PUT',
        DELETE = 'DELETE'
    }

    export async function request(method: RESTMethod, url: string, body: any | undefined = undefined) {
        let bodyStr = body ? JSON.stringify(body) : undefined;
        let args = ['rest',
            '--method', method,
            '--uri', url,
        ];
        if (bodyStr) args.push('--body', `"${bodyStr.replaceAll(`'`, `\\'`).replaceAll(`"`, `'`)}"`);
        outputChannel.appendLine('[CMD] > az ' + args.join(' '));
        let proc = cp.spawnSync('az', args, {shell: true});
        let stdout = proc.stdout.toString();
        let stderr = proc.stderr.toString();
        if (stdout) {
            outputChannel.appendLine('[CMD OUT] ' + stdout);
            return JSON.parse(stdout);
        }
        if (stderr) {
            outputChannel.appendLine('[CMD ERR] ' + stderr);
            throw new Error(stderr);
        }
        if (proc.error) {
            outputChannel.appendLine('[CMD ERR] ' + proc.error.message);
            throw new Error(proc.error.message);
        }
    }

    export async function getWorkspaces() {
        let response = await request(
            RESTMethod.POST,
            '/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
            {query: "resources | where type == 'microsoft.machinelearningservices/workspaces' | order by tolower(name) asc",}
        );
        let workspaces: Workspace[] = [];
        for (let ws of response.data) {
            workspaces.push(new Workspace(ws.id, ws.name, ws.subscriptionId, ws.resourceGroup));
        }
        
        console.log('msra_intern_s_toolkit.helper.singularity.REST.getWorkspaces: Found ' + workspaces.length + ' workspaces');
        console.log(workspaces);
        return workspaces;
    }

    export async function getVirtualClusters() {
        // Get virtual clusters
        let response = await request(
            RESTMethod.POST,
            '/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
            {query: "resources | where type == 'microsoft.machinelearningservices/virtualclusters' | order by tolower(name) asc",}
        );
        let virtualClusters: VirtualCluster[] = [];
        for (let vc of response.data) {
            let newVC = new VirtualCluster(vc.id, vc.subscriptionId, vc.resourceGroup, vc.name, vc.location);
            let instanceSeriesMap = new Map<string, InstanceSeries>();
            for (let limit of vc.properties.managed.defaultGroupPolicyOverallQuotas.limits) {
                if (!instanceSeriesMap.has(limit.id)) {
                    instanceSeriesMap.set(limit.id, new InstanceSeries(limit.id, limit.name));
                }
                let series = instanceSeriesMap.get(limit.id)!;
                series.limit = {limit: limit.limit, used: limit.used};
            }
            for (let location of Object.keys(vc.properties.managed.quotas)) {
                let quota = vc.properties.managed.quotas[location as keyof typeof vc.properties.managed.quotas];
                for (let limit of quota.limits) {
                    if (!instanceSeriesMap.has(limit.id)) {
                        instanceSeriesMap.set(limit.id, new InstanceSeries(limit.id, limit.name));
                    }
                    let series = instanceSeriesMap.get(limit.id)!;
                    series.quota[limit.slaTier as keyof Quota].limit = limit.limit;
                    series.quota[limit.slaTier as keyof Quota].used = limit.used;
                }
            }
            newVC.instanceSeries = Array.from(instanceSeriesMap.values());
            virtualClusters.push(newVC);
        }

        // Get instance types
        let requests = [];
        for (let vc of virtualClusters) {
            requests.push({
                HttpMethod: RESTMethod.GET,
                RelativeUrl: `/subscriptions/${vc.subscriptionId}/providers/Microsoft.MachineLearningServices/locations/${vc.location}/instancetypeseries?api-version=2021-03-01-preview`
            });
        }
        let responses = await request(
            RESTMethod.POST,
            '/batch?api-version=2020-06-01',
            {requests: requests}
        );
        responses = responses.responses;
        for (let i = 0; i < responses.length; i++) {
            response = responses[i].content;
            let vc = virtualClusters[i];
            for (let instanceType of response.value) {
                let series = vc.instanceSeries.find((series) => series.id == instanceType.instanceTypeSeriesId);
                if (series) {
                    series.instanceTypes.push(
                        new InstanceType(instanceType.name.replace('Singularity.', ''), instanceType.description, instanceType.numberOfCores, instanceType.numberOfGPpus)
                    );
                }
            }
        }

        console.log('msra_intern_s_toolkit.helper.singularity.REST.getVirtualClusters: Found ' + virtualClusters.length + ' virtual clusters');
        console.log(virtualClusters);
        return virtualClusters;
    }

    export async function getImages(InstanceTypeName: string = 'ND5_v2g1') {
        let response = await request(
            RESTMethod.GET,
            `https://ml.azure.com/api/westus2/virtualcluster/rp/subscriptions/22da88f6-1210-4de2-a5a3-da4c7c2a1213/managedComputeImages?api-version=2021-03-01-preview&instanceType=Singularity.${InstanceTypeName}`
        );
        let images: Image[] = [];
        for (let key of Object.keys(response)) {
            images.push(new Image(key, response[key]));
        }
        console.log('msra_intern_s_toolkit.helper.singularity.REST.getImages: Found ' + images.length + ' images');
        console.log(images);
        return images;
    }
}

export function findDefaultWorkspace(workspaces: Workspace[], virtualClusters: VirtualCluster[]) {
    let subRg2ws = new Map<string, Workspace>();
    for (let ws of workspaces) {
        subRg2ws.set(ws.subscriptionId + ws.resourceGroup, ws);
    }
    for (let vc of virtualClusters) {
        if (subRg2ws.has(vc.subscriptionId + vc.resourceGroup)) {
            vc.defaultWorkspace = subRg2ws.get(vc.subscriptionId + vc.resourceGroup);
        }
    }

    console.log('msra_intern_s_toolkit.helper.singularity.findDefaultWorkspace: Finished');
    console.log(virtualClusters);
}
