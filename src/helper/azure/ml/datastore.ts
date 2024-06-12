import * as cp from 'child_process'
import * as YAML from 'yaml'
import { Workspace, Datastore } from './resource'
import { outputChannel } from '../../../extension'

export class Spec{
    name: string;
    type: string;
    description: string;
    account_name: string;
    container_name: string;
    credentials?: object;

    constructor(name: string, type: string, description: string, account_name: string, container_name: string, credentials?: object){
        this.name = name;
        this.type = type;
        this.description = description;
        this.account_name = account_name;
        this.container_name = container_name;
        if(credentials){
            this.credentials = credentials;
        }
    }

    yaml(): string{
        return YAML.stringify(this);
    }
}

export async function buildBlobContainerSpec(datastore: Datastore) {
    let credentials = undefined;
    switch(datastore.authType){
        case 'key':
            credentials = {account_key: datastore.blobContainer.storageAccount.key};
            break;
        case 'sas':
            credentials = {sas_token: (await datastore.blobContainer.getSAS()).token};
            break;
        case 'identity':
            credentials = undefined;
            break;
    }
    return new Spec(
        datastore.name,
        'azure_blob',
        'Azure Blob Storage',
        datastore.blobContainer.storageAccount.name,
        datastore.blobContainer.name,
        credentials,
    );
}

export async function create(Workspace: Workspace, specFile: string): Promise<any> {
    outputChannel.appendLine(`[CMD] > az ml datastore create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`);
    return new Promise((resolve, reject) => {
        cp.exec(`az ml datastore create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`, {}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine(`[CMD OUT] ${stdout}`);
                resolve(JSON.parse(stdout));
            }
            if (error) {
                outputChannel.appendLine(`[CMD ERR] ${error.message}`);
                console.error(`msra_intern_s_toolkit.createDatastore: error - ${error.message}`);
                reject('failed_to_create_datastore');
            }
            if (stderr) {
                outputChannel.appendLine(`[CMD ERR] ${stderr}`);
                console.error(`msra_intern_s_toolkit.createDatastore: stderr - ${stderr}`);
                if (stderr.includes(`'ml' is misspelled or not recognized by the system.`)) {
                    reject('azure_ml_ext_not_installed');
                }
                reject('failed_to_create_datastore');
            }
        });
    });
}
