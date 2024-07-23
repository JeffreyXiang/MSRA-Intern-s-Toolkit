
import * as rest from '../rest'
import { Workspace, Datastore } from './resource'

export async function create(
    workspace: Workspace,
    datastore: Datastore,
    configDir?: string
): Promise<any> {
    let body: any = {
        properties: {
            dataStoreType: 'AzureBlob',
            accountName: datastore.blobContainer.storageAccount.name,
            containerName: datastore.blobContainer.name,
        }
    }

    if (datastore.blobContainer.storageAccount.resourceGroup) {
        body.properties['resourceGroup'] = datastore.blobContainer.storageAccount.resourceGroup;
    }
    if (datastore.blobContainer.storageAccount.subscription) {
        body.properties['subscriptionId'] = datastore.blobContainer.storageAccount.subscription;
    }
    
    switch (datastore.authType) {
        case 'key':
            body.properties['credentials'] = {
                credentialsType: 'AccountKey',
                secrets: {
                    secretsType: 'AccountKey',
                    key: datastore.blobContainer.storageAccount.key
                }
            }
            break;
        case 'sas':
            body.properties['credentials'] = {
                credentialsType: 'Sas',
                secrets: {
                    secretsType: 'Sas',
                    sasToken: (await datastore.blobContainer.generateSAS(7, 'acdlrw', configDir)).token
                }
            }
            break;
        case 'identity':
            body.properties['credentials'] = {credentialsType: 'None'};
            break;
        default:
            throw 'unsupported_auth_type';
    }

    if (datastore.allowWorkspaceManagedIdentityAccess) {
        body.properties['serviceDataAccessAuthIdentity'] = 'WorkspaceSystemAssignedIdentity';
    }

    try {
        return await rest.request(
            rest.RESTMethod.PUT,
            `/subscriptions/${workspace.subscriptionId}/resourceGroups/${workspace.resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspace.name}/datastores/${datastore.name}?api-version=2024-04-01`,
            body,
            undefined,
            configDir
        );
    }
    catch (e) {
        throw e;
    }
}
