import * as cp from 'child_process'
import * as YAML from 'yaml'
import {VirtualCluster, Workspace, Image} from './resource'
import {outputChannel} from '../../../extension'

export class Input{
    name: string;
    path: string;
    type: string='uri_folder';
    mode: string='ro_mount';

    constructor(name: string, path: string, type?: string, mode?: string){
        this.name = name;
        this.path = path;
        if(type){
            this.type = type;
        }
        if(mode){
            this.mode = mode;
        }
    }
}

export class Output{
    name: string;
    path: string;
    type: string='uri_folder';
    mode: string='rw_mount';

    constructor(name: string, path: string, type?: string, mode?: string){
        this.name = name;
        this.path = path;
        if(type){
            this.type = type;
        }
        if(mode){
            this.mode = mode;
        }
    }
}

export class Spec{
    display_name: string;
    experiment_name: string;
    code: string;
    command: string;
    inputs: object;
    outputs: object;
    environment: object;
    compute: string;
    distribution: object;
    resources: object;

    constructor(display_name: string, experiment_name: string, code: string, command: string, inputs: Input[], outputs: Output[], environment: object, compute: string, distribution: object, resources: object){
        this.display_name = display_name;
        this.experiment_name = experiment_name;
        this.code = code;
        this.command = command;
        this.inputs = new Object();
        this.outputs = new Object();
        this.environment = environment;
        this.compute = compute;
        this.distribution = distribution;
        this.resources = resources;

        for(let i=0; i<inputs.length; i++){
            (this.inputs as any)[inputs[i].name] = {
                path: inputs[i].path,
                type: inputs[i].type,
                mode: inputs[i].mode
            }
        }
        for(let i=0; i<outputs.length; i++){
            (this.outputs as any)[outputs[i].name] = {
                path: outputs[i].path,
                type: outputs[i].type,
                mode: outputs[i].mode
            }
        }
    }

    yaml(): string{
        return YAML.stringify(this);
    }
}

export function buildSingulaitySpec(
    displayName: string,
    experimentName: string,
    code: string,
    command: string,
    inputs: Input[],
    outputs: Output[],
    image: Image,
    virtualCluster: VirtualCluster,
    instanceType: string,
    nodeCount: number,
    slaTier: string,
): Spec{
    return new Spec(
        displayName,
        experimentName,
        code,
        command,
        inputs,
        outputs,
        {image: 'mcr.microsoft.com/azureml/openmpi3.1.2-ubuntu18.04:20210513.v1'},
        [
            `/subscriptions/${virtualCluster.subscriptionId}`,
            `/resourceGroups/${virtualCluster.resourceGroup}`,
            `/providers/Microsoft.MachineLearningServices`,
            `/virtualclusters/${virtualCluster.name}`,
        ].join(''),
        {
            type: 'PyTorch',
            process_count_per_instance: 1,
        },
        {
            instance_type: `Singularity.${instanceType}`,
            instance_count: nodeCount,
            properties: {
                AISuperComputer: {
                    interactive: (slaTier == 'Premium') ? true : false,
                    imageVersion: image.name,
                    priority: 'High',
                    slaTier: slaTier,
                    scalePolicy: {
                        autoScaleIntervalInSec: 120,
                        maxInstanceTypeCount: nodeCount,
                        minInstanceTypeCount: nodeCount,
                    }
                },
            },
        }
    );
}

export async function create(Workspace: Workspace, specFile: string): Promise<any> {
    outputChannel.appendLine(`[CMD] > az ml job create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`);
    return new Promise((resolve, reject) => {
        cp.exec(`az ml job create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`, {}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine(`[CMD OUT] ${stdout}`);
                resolve(JSON.parse(stdout));
            }
            if (error) {
                outputChannel.appendLine(`[CMD ERR] ${error.message}`);
                console.error(`msra_intern_s_toolkit.create: error - ${error.message}`);
                reject('failed_to_create_job');
            }
            if (stderr) {
                outputChannel.appendLine(`[CMD ERR] ${stderr}`);
                console.error(`msra_intern_s_toolkit.create: stderr - ${stderr}`);
                if (stderr.includes(`'ml' is misspelled or not recognized by the system.`)) {
                    reject('azure_ml_ext_not_installed');
                }
                reject('failed_to_create_job');
            }
        });
    });
}
