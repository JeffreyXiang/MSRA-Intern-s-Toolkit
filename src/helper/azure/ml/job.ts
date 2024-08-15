import * as cp from 'child_process'
import * as YAML from 'yaml'
import {VirtualCluster, Workspace, Image} from './resource'
import {outputChannel} from '../../../extension'
import {parseJson} from '../utils'

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
    environment_variables?: object;
    inputs: object;
    outputs: object;
    environment: object;
    compute: string;
    distribution: object;
    resources: object;
    identity?: object;

    constructor(display_name: string, experiment_name: string, code: string, command: string, environment_variables: object | undefined, inputs: Input[], outputs: Output[], environment: object, compute: string, distribution: object, resources: object, identity?: object) {        this.display_name = display_name;
        this.experiment_name = experiment_name;
        this.code = code;
        this.command = command;
        if (environment_variables && Object.keys(environment_variables).length > 0)
            this.environment_variables = environment_variables;
        this.inputs = new Object();
        this.outputs = new Object();
        this.environment = environment;
        this.compute = compute;
        this.distribution = distribution;
        this.resources = resources;
        if (identity)
            this.identity = identity;

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
    envs: object,
    inputs: Input[],
    outputs: Output[],
    image: Image,
    virtualCluster: VirtualCluster,
    instanceType: string,
    nodeCount: number,
    priority: string,
    slaTier: string,
    interactive: boolean,
    enableAzmlInt: boolean,
): Spec{
    return new Spec(
        displayName,
        experimentName,
        code,
        command,
        envs,
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
                    interactive: interactive,
                    imageVersion: image.name,
                    priority: priority,
                    slaTier: slaTier,
                    enableAzmlInt: enableAzmlInt,
                    scalePolicy: {
                        autoScaleIntervalInSec: 120,
                        maxInstanceTypeCount: nodeCount,
                        minInstanceTypeCount: nodeCount,
                    }
                },
            },
        },
    );
}

export async function create(Workspace: Workspace, specFile: string, configDir?: string): Promise<any> {
    if (!specFile.startsWith('\"') && !specFile.endsWith('\"')) specFile = `"${specFile}"`;
    outputChannel.appendLine(`[CMD] > az ml job create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(`az ml job create -f ${specFile} -w ${Workspace.name} -g ${Workspace.resourceGroup} --subscription ${Workspace.subscriptionId}`, {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`[CMD ERR] ${error.message}`);
                console.error(`msra_intern_s_toolkit.create: error - ${error.message}`);
                if (stderr.includes(`'ml' is misspelled or not recognized by the system.`)) {
                    reject('azure_ml_ext_not_installed');
                }
                reject('failed_to_create_job');
            }
            if (stdout) {
                outputChannel.appendLine(`[CMD OUT] ${stdout}`);
                try {
                    resolve(parseJson(stdout));
                }
                catch (e) {
                    reject(e);
                }
            }
            if (stderr) {
                outputChannel.appendLine(`[CMD ERR] ${stderr}`);
                console.error(`msra_intern_s_toolkit.create: stderr - ${stderr}`);
                reject('failed_to_create_job');
            }
        });
    });
}
