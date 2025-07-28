import * as cp from 'child_process'
import { outputChannel } from '../../../extension'
import { BlobContainer } from '../storage';
import * as rest from '../rest';
import { parseJson } from '../utils';

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
    locations: string[] = [];
    instanceSeries: InstanceSeries[] = [];
    defaultWorkspace: Workspace | undefined = undefined;

    constructor(id: string, subscriptionId: string, resourceGroup: string, name: string, location: string, locations: string[] = []) {
        this.id = id;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
        this.name = name;
        this.location = location;
        if (locations != null) this.locations = locations;
    }

    static fromJSON(obj: any) {
        let vc = new VirtualCluster(obj.id, obj.subscriptionId, obj.resourceGroup, obj.name, obj.location, obj.locations);
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
    containerRegistry: ContainerRegistry;
    images: Image[] = [];
    acrImages: AcrImage[] = [];

    constructor(id: string, name: string, subscriptionId: string, resourceGroup: string, location: string, containerRegistry: ContainerRegistry, images: Image[] = [], acrImages: AcrImage[] = []) {
        this.id = id;
        this.name = name;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
        this.location = location;
        this.containerRegistry = containerRegistry;
        this.images = images;
        this.acrImages = acrImages;
    }

    static fromJSON(obj: any) {
        let new_ws = new Workspace(obj.id, obj.name, obj.subscriptionId, obj.resourceGroup, obj.location, obj.containerRegistry);
        if (obj.hasOwnProperty('images')) {
            new_ws.images = obj.images.map((image: any) => Image.fromJSON(image));
        }
        if (obj.hasOwnProperty('acrImages')) {
            new_ws.acrImages = obj.acrImages.map((acrImage: any) => AcrImage.fromJSON(acrImage));
        }
        return new_ws;
    }
}

export class ContainerRegistry {
    name: string;
    subscriptionId: string;
    resourceGroup: string;

    constructor(name: string, subscriptionId: string, resourceGroup: string) {
        this.name = name;
        this.subscriptionId = subscriptionId;
        this.resourceGroup = resourceGroup;
    }

    static fromJSON(obj: any) {
        return new ContainerRegistry(obj.name, obj.subscriptionId, obj.resourceGroup);
    }

    static fromString(str: string): ContainerRegistry {
        // "/subscriptions/<sub-id>/resourceGroups/<rg-name>/providers/Microsoft.ContainerRegistry/registries/<acr-name>"
        const parts = str.split('/');

        if (
            parts.length < 9 ||
            parts[1] !== 'subscriptions' ||
            parts[3] !== 'resourceGroups' ||
            parts[5] !== 'providers' ||
            parts[6] !== 'Microsoft.ContainerRegistry' ||
            parts[7] !== 'registries'
        ) {
            throw new Error(`Invalid ACR resource ID format: ${str}`);
        }

        const subscriptionId = parts[2];
        const resourceGroup = parts[4];
        const name = parts[8];

        return new ContainerRegistry(name, subscriptionId, resourceGroup);
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

export class AcrImage {
    loginServer: string;
    repository: string;
    tag: string;

    constructor(loginServer: string, repository: string, tag: string) {
        this.loginServer = loginServer;
        this.repository = repository;
        this.tag = tag;
    }

    static fromJSON(obj: any) {
        return new AcrImage(obj.loginServer, obj.repository, obj.tag);
    }

    static fromString(str: string) {
        let firstSlash = str.indexOf('/');
        let lastColon = str.lastIndexOf(':');
        if (firstSlash === -1 || lastColon === -1 || lastColon < firstSlash) {
            throw new Error(`Invalid ACR image string: ${str}`);
        }
        let loginServer = str.substring(0, firstSlash);
        let repository = str.substring(firstSlash + 1, lastColon);
        let tag = str.substring(lastColon + 1);

        return new AcrImage(loginServer, repository, tag);
    }

    toString() {
        return `${this.loginServer}/${this.repository}:${this.tag}`;
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
        workspaces.push(new Workspace(ws.id, ws.name, ws.subscriptionId, ws.resourceGroup, ws.location, ContainerRegistry.fromString(ws.properties.containerRegistry)));
    }

    // Get images
    let images = await Promise.all(workspaces.map((ws) => getImages(ws, configDir)));
    for (let i = 0; i < images.length; i++) {
        workspaces[i].images = images[i];
    }

    // Get acr images
    let acrImages = await Promise.all(workspaces.map((ws) => getAcrImages(ws, configDir)));
    for (let i = 0; i < acrImages.length; i++) {
        workspaces[i].acrImages = acrImages[i];
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
        let newVC = new VirtualCluster(vc.id, vc.subscriptionId, vc.resourceGroup, vc.name, vc.location, vc.properties.managed.locations);
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
                series.quota[limit.slaTier as keyof Quota].limit += limit.limit;
                series.quota[limit.slaTier as keyof Quota].used += limit.used;
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


export async function getAcrImages(workspace: Workspace, configDir?: string) {
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    let cr = workspace.containerRegistry;
    outputChannel.appendLine(`[CMD] > az acr repository list --name ${cr.name} --subscription ${cr.subscriptionId}`);
    let response = cp.execSync(`az acr repository list --name ${cr.name} --subscription ${cr.subscriptionId}`, {env: env}).toString();
    let repositories = parseJson(response);
    let tags = await Promise.all(repositories.map(async (repository: any) => {
        outputChannel.appendLine(`[CMD] > az acr repository show-tags --name ${cr.name} --repository ${repository} --subscription ${cr.subscriptionId}`);
        let response = cp.execSync(`az acr repository show-tags --name ${cr.name} --repository ${repository} --subscription ${cr.subscriptionId}`, {env: env}).toString();
        return parseJson(response);
    }));
    let acrImages: AcrImage[] = [];
    let loginServer = `${cr.name}.azurecr.io`;
    for (let i = 0; i < repositories.length; i++) {
        for (let tag of tags[i]) {
            acrImages.push(new AcrImage(loginServer, repositories[i], tag));
        }
    }
    console.log('msra_intern_s_toolkit.helper.azureml.getAcrImages: Found ' + acrImages.length + ' acr images');
    console.log(acrImages);
    return acrImages;
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
