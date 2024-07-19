import * as cp from 'child_process'
import {outputChannel} from '../../../extension'
import { BlobContainer } from '../storage';
import * as rest from '../rest';

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

    static fromJSON(obj: any) {
        return new InstanceType(obj.name, obj.description, obj.cpus, obj.gpus);
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

    static fromJSON(obj: any) {
        let series = new InstanceSeries(obj.id, obj.name);
        series.quota.Basic = {limit: obj.quota.Basic.limit, used: obj.quota.Basic.used};
        series.quota.Standard = {limit: obj.quota.Standard.limit, used: obj.quota.Standard.used};
        series.quota.Premium = {limit: obj.quota.Premium.limit, used: obj.quota.Premium.used};
        if (obj.limit) series.limit = {limit: obj.limit.limit, used: obj.limit.used};
        series.instanceTypes = obj.instanceTypes.map((instanceType: any) => InstanceType.fromJSON(instanceType));
        return series;
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

    static fromJSON(obj: any) {
        let vc = new VirtualCluster(obj.id, obj.subscriptionId, obj.resourceGroup, obj.name, obj.location);
        vc.instanceSeries = obj.instanceSeries.map((instanceSeries: any) => InstanceSeries.fromJSON(instanceSeries));
        if (obj.defaultWorkspace) vc.defaultWorkspace = Workspace.fromJSON(obj.defaultWorkspace);
        return vc;
    }

}

export class Workspace {
    id: string;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
    location: string = '';
    images: Image[] = [];

    constructor(id: string, name: string, subscriptionId: string, resourceGroup: string, location: string, images: Image[] = []) {
        this.id = id;
        this.name = name;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
        this.location = location;
        this.images = images;
    }

    static fromJSON(obj: any) {
        let new_ws = new Workspace(obj.id, obj.name, obj.subscriptionId, obj.resourceGroup, obj.location);
        if (obj.hasOwnProperty('images')) {
            new_ws.images = obj.images.map((image: any) => Image.fromJSON(image));
        }
        return new_ws;
    }
}

export class Image {
    name: string;
    description: string;

    constructor(name: string, description: string) {
        this.name = name;
        this.description = description;
    }

    static fromJSON(obj: any) {
        return new Image(obj.name, obj.description);
    }
}

export class Datastore {
    name: string;
    blobContainer: BlobContainer;
    authType: string;
    allowWorkspaceManagedIdentityAccess: boolean;

    constructor(name: string, blobContainer: BlobContainer, authType: string, allowWorkspaceManagedIdentityAccess: boolean = false) {
        this.name = name;
        this.blobContainer = blobContainer;
        this.authType = authType;
        this.allowWorkspaceManagedIdentityAccess = allowWorkspaceManagedIdentityAccess;
    }

    static fromJSON(obj: any) {
        let ret = new Datastore(obj.name, BlobContainer.fromJSON(obj.blobContainer), obj.authType);
        if (obj.hasOwnProperty('allowWorkspaceManagedIdentityAccess')) {
            ret.allowWorkspaceManagedIdentityAccess = obj.allowWorkspaceManagedIdentityAccess;
        }
        return ret;
    }

    public getUri(directory: string) {
        return `azureml://datastores/${this.name}/paths/${directory}`;
    }
}

export async function getWorkspaces(configDir?: string) {
    let response = await rest.request(
        rest.RESTMethod.POST,
        '/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
        {query: "resources | where type == 'microsoft.machinelearningservices/workspaces' | order by tolower(name) asc",},
        undefined,
        configDir,
    );
    let workspaces: Workspace[] = [];
    for (let ws of response.data) {
        workspaces.push(new Workspace(ws.id, ws.name, ws.subscriptionId, ws.resourceGroup, ws.location));
    }

    // Get images
    let requests = workspaces.map((ws) => getImages(ws, configDir));
    let responses = await Promise.all(requests);
    for (let i = 0; i < responses.length; i++) {
        workspaces[i].images = responses[i];
    }
    
    console.log('msra_intern_s_toolkit.helper.azureml.getWorkspaces: Found ' + workspaces.length + ' workspaces');
    console.log(workspaces);
    return workspaces;
}

export async function getVirtualClusters(configDir?: string) {
    // Get virtual clusters
    let response = await rest.request(
        rest.RESTMethod.POST,
        '/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01',
        {query: "resources | where type == 'microsoft.machinelearningservices/virtualclusters' | order by tolower(name) asc",},
        undefined,
        configDir,
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

    if (virtualClusters.length == 0) {
        console.log('msra_intern_s_toolkit.helper.azureml.getVirtualClusters: No virtual clusters found');
        return [];
    }

    // Get instance types
    let requests = [];
    for (let vc of virtualClusters) {
        requests.push({
            httpMethod: rest.RESTMethod.GET,
            relativeUrl: `/subscriptions/${vc.subscriptionId}/providers/Microsoft.MachineLearningServices/locations/${vc.location}/instancetypeseries?api-version=2021-03-01-preview`
        });
    }
    let responses = await rest.batchRequest(requests);
    for (let i = 0; i < responses.length; i++) {
        response = responses[i].content;
        let vc = virtualClusters[i];
        for (let instanceType of response.value) {
            let series = vc.instanceSeries.find((series) => series.id == instanceType.instanceTypeSeriesId);
            if (series) {
                series.instanceTypes.push(
                    new InstanceType(instanceType.name.replace('Singularity.', ''), instanceType.description, instanceType.numberOfCores, instanceType.numberOfGPUs)
                );
            }
        }
    }

    console.log('msra_intern_s_toolkit.helper.azureml.getVirtualClusters: Found ' + virtualClusters.length + ' virtual clusters');
    console.log(virtualClusters);
    return virtualClusters;
}

export async function getImages(workspace: Workspace, configDir?: string) {
    let response = await rest.request(
        rest.RESTMethod.GET,
        `https://ml.azure.com/api/${workspace.location}/virtualcluster/rp/subscriptions/${workspace.subscriptionId}/managedComputeImages?api-version=2021-03-01-preview`,
        undefined,
        undefined,
        configDir,
    );
    let images: Image[] = [];
    for (let key of Object.keys(response)) {
        images.push(new Image(key, response[key]));
    }
    console.log('msra_intern_s_toolkit.helper.azureml.getImages: Found ' + images.length + ' images');
    console.log(images);
    return images;
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

    console.log('msra_intern_s_toolkit.helper.azureml.findDefaultWorkspace: Finished');
    console.log(virtualClusters);
}
