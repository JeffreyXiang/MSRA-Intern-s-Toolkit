import * as vscode from 'vscode';
import * as cp from 'child_process'
import {vscodeContext} from './extension'
import {SubmitJobsView} from './ui/submit_jobs'
import { getFile, globalPath, listFiles, saveFile, showErrorMessageWithHelp } from './utils';
import { resolve } from 'path';

export class JobConfig {
    cluster: {
        virtual_cluster: string;
        instance_type: string;
        sla_tier: string;
    } = {virtual_cluster: '', instance_type: '', sla_tier: ''};
    storage: {
        datastore_name: string;
        container_name: string;
        account_name: string;
        account_key: string;
    } = {datastore_name: '', container_name: '', account_name: '', account_key: ''};
    environment: {
        docker_image: string;
        setup_script: string;        
    } = {docker_image: '', setup_script: ''};
    experiment: {
        name: string;
        workdir: string;
        copy_data: boolean;
        sas_token: string;
        data_dir: string;
        script: string;
    } = {name: '', workdir: '', copy_data: false, sas_token: '', data_dir: '', script: ''};
}

var config: JobConfig;

export var ui: SubmitJobsView;

export function submit() {
    vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        ((cfg) => (async (progress) => {
            progress.report({message: "Submitting the job..."});
            return new Promise<void> (resolve => {
                checkCondaEnv(true).then((passed) => {
                    if (passed) {
                        let cfgPath = `./userdata/submit_jobs_${new Date().getTime()}.json`
                        saveFile(cfgPath, cfg);
                        let proc = cp.spawn('conda', ['activate', 'msra-intern-s-toolkit', '&&', 'python', globalPath('script/submit_jobs/submit.py'), '--config', globalPath(cfgPath)], {shell: true});
                        let timeout = setTimeout(() => {
                            proc.kill();
                            showErrorMessageWithHelp(`Failed to submit the job. Command timeout.`);
                            resolve();
                        }, 60000);
                        proc.stdout.on('data', (data) => {
                            let sdata = String(data);
                            // console.log(`msra_intern_s_toolkit.submit: ${sdata}`);
                            if (sdata.includes('Run(')) {
                                proc.kill();
                                clearTimeout(timeout);
                                let id = sdata.trim().slice(4, -1).split(',')[1].trim().slice(4);
                                vscode.window.showInformationMessage(`Job submitted. Id: ${id}`);
                                saveFile(`./userdata/jobs_history/${id}.json`, cfg);
                                resolve();
                            }
                        });
                        proc.stderr.on('data', (data) => {
                            let sdata = String(data);
                            // console.error(`msra_intern_s_toolkit.submit: ${sdata}`);
                        });
                        proc.on('exit', (code) => {
                            clearTimeout(timeout);
                            if (code != null) showErrorMessageWithHelp(`Failed to submit the job. Unknown reason. code ${code}`);
                            // console.log(`msra_intern_s_toolkit.submit: Process exited with ${code}`);
                            resolve();
                        });
                    }
                    else resolve();
                });
            });
        }))(JSON.stringify(config))
    );
}

export function updateConfig(group: string, label: string, value: any) {
    (config as any)[group][label] = value;
    saveFile('./userdata/submit_jobs.json', JSON.stringify(config));
}

export async function loadHistory() {
    let res = await vscode.window.showQuickPick(
        listFiles('userdata/jobs_history')
            .map((v) => v.slice(0, -5))
            .sort((a, b) => {
                let a_ = a.split('_');
                let b_ = b.split('_');
                let ta = parseInt(a_[a_.length-2]);
                let tb = parseInt(b_[b_.length-2]);
                return tb - ta;
            }), {
        title: 'Select job config',
        canPickMany: false,
        ignoreFocusOut: true
    });
    if (res == undefined) return;
    config = JSON.parse(getFile(`./userdata/jobs_history/${res}.json`));
    saveFile('./userdata/submit_jobs.json', JSON.stringify(config));
    refreshUI();
}

function showSetupCondaEnvMessage() {
    vscode.window.showInformationMessage('Conda environment not found. Setup now?', 'Yes', 'No').then((choice) => {
        if (choice == 'Yes') {
            setupCondaEnv();
        }
    });
}

function checkCondaEnv(showErrorMsg: boolean=false): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        cp.exec('conda env list', (error, stdout, stderr) => {
            if (stdout) {
                let passed = stdout.includes('msra-intern-s-toolkit');
                if (!passed) {
                    if (showErrorMsg) showErrorMessageWithHelp(`Failed to submit the job. Conda environment not found.`);
                    showSetupCondaEnvMessage();
                }
                resolve(passed);
            }
            else if (error) {
                if (showErrorMsg) showErrorMessageWithHelp(`Failed to submit the job. Conda spawning failed.`);
                resolve(false);
            }
        });
    });
}

async function setupCondaEnv() {
    vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        async (progress) => {
            progress.report({message: "Setting up the conda environment..."});
            return new Promise<void> (resolve => {
                let proc = cp.spawn('conda', ['env', 'create', '-f', globalPath('script/environment.yml')], {shell: true});
                proc.stdout.on('data', (data) => {
                    let sdata = String(data);
                    if (sdata.includes('conda activate msra-intern-s-toolkit')) {
                        vscode.window.showInformationMessage(`Conda environment setup done.`);
                        resolve();
                    }
                });
                proc.on('exit', (code) => {
                    if (code != 0) vscode.window.showErrorMessage(`Failed to setup conda environment.`);
                    resolve();
                });
            });
        }
    )
}

export function init() {
    checkCondaEnv();
    
    config = JSON.parse(getFile('./userdata/submit_jobs.json'));

    ui = new SubmitJobsView();
    vscodeContext.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'msra_intern_s_toolkit_view_submitJobs',
        ui,
        {webviewOptions: {retainContextWhenHidden: true}}
    ));
}

export function refreshUI() {
    if (ui != undefined) {
        ui.setContent(config);
    }
}
