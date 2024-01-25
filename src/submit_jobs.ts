import * as vscode from 'vscode';
import * as cp from 'child_process'
import {vscodeContext, outputChannel} from './extension'
import {SubmitJobsView} from './ui/submit_jobs'
import { getWorkspaceFile, globalPath, workspacePath, listWorkspaceFiles, workspaceExists, saveWorkspaceFile, showErrorMessageWithHelp } from './utils';

class ClusterConfig {
    virtual_cluster: string = 'msroctovc'
    instance_type: string = ''
    node_count: number = 1
    sla_tier: string = 'Basic'
}

class StorageConfig {
    datastore_name: string = ''
    container_name: string = ''
    account_name: string = ''
    account_key: string = ''
    sas_token: string = ''
}

class EnvironmentConfig {
    docker_image: string = ''
    setup_script: string | Array<string> = ''
}

class ExperimentConfig {
    name: string = ''
    job_name: string = ''
    workdir: string = ''
    copy_data: boolean = true
    sync_code: boolean = true
    data_dir: string = ''
    data_subdir: string = ''
    ignore_dir: string = ''
    script: string | Array<string> = ''
}

export class JobConfig {
    cluster: ClusterConfig = new ClusterConfig();
    storage: StorageConfig = new StorageConfig();
    environment: EnvironmentConfig = new EnvironmentConfig();
    experiment: ExperimentConfig = new ExperimentConfig();
    
    constructor(init?: any) {
        if (init === undefined) return;

        if (init.cluster !== undefined) {
            if (init.cluster.virtual_cluster !== undefined) this.cluster.virtual_cluster = init.cluster.virtual_cluster;
            if (init.cluster.instance_type !== undefined) this.cluster.instance_type = init.cluster.instance_type;
            if (init.cluster.node_count !== undefined) this.cluster.node_count = init.cluster.node_count;
            if (init.cluster.sla_tier !== undefined) this.cluster.sla_tier = init.cluster.sla_tier;
        }

        if (init.storage !== undefined) {
            if (init.storage.datastore_name !== undefined) this.storage.datastore_name = init.storage.datastore_name;
            if (init.storage.container_name !== undefined) this.storage.container_name = init.storage.container_name;
            if (init.storage.account_name !== undefined) this.storage.account_name = init.storage.account_name;
            if (init.storage.account_key !== undefined) this.storage.account_key = init.storage.account_key;
            if (init.storage.sas_token !== undefined) this.storage.sas_token = init.storage.sas_token;
        }

        if (init.environment !== undefined) {
            if (init.environment.docker_image !== undefined) this.environment.docker_image = init.environment.docker_image;
            if (init.environment.setup_script !== undefined) this.environment.setup_script = init.environment.setup_script;
        }

        if (init.experiment !== undefined) {
            if (init.experiment.name !== undefined) this.experiment.name = init.experiment.name;
            if (init.experiment.job_name !== undefined) this.experiment.job_name = init.experiment.job_name;
            if (init.experiment.workdir !== undefined) this.experiment.workdir = init.experiment.workdir;
            if (init.experiment.copy_data !== undefined) this.experiment.copy_data = init.experiment.copy_data;
            if (init.experiment.sync_code !== undefined) this.experiment.sync_code = init.experiment.sync_code;
            if (init.experiment.data_dir !== undefined) this.experiment.data_dir = init.experiment.data_dir;
            if (init.experiment.data_subdir !== undefined) this.experiment.data_subdir = init.experiment.data_subdir;
            if (init.experiment.ignore_dir !== undefined) this.experiment.ignore_dir = init.experiment.ignore_dir;
            if (init.experiment.script !== undefined) this.experiment.script = init.experiment.script;
        }

        // v1.2 convertion
        if (typeof this.environment.setup_script === 'string') this.environment.setup_script = this.environment.setup_script.split('\n');
        if (typeof this.experiment.script === 'string') this.experiment.script = this.experiment.script.split('\n');

        // v1.3 convertion
        if (init.experiment.sas_token) this.storage.sas_token = init.experiment.sas_token;
    }
}

var config: JobConfig;

export var ui: SubmitJobsView;

export async function synchronize() {
    if (!config.experiment.sync_code) return 'skipped';
    return vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        ((cfg) => (async (progress) => {
            progress.report({message: "Synchronizing code...", increment: 0});
            return new Promise<string> (resolve => {
                let source = `"${workspacePath('../*')}"`;
                let destination = `"${cfg.storage.sas_token.split('?')[0]}/${cfg.experiment.workdir}/?${cfg.storage.sas_token.split('?')[1]}"`;
                let args = ['copy', source, destination, '--recursive'];
                if (cfg.experiment.ignore_dir) args.push('--exclude-path', `".msra_intern_s_toolkit;.git;${cfg.experiment.ignore_dir}"`);
                else args.push('--exclude-path', '".msra_intern_s_toolkit;.git"');
                outputChannel.appendLine(`[CMD] > azcopy ${args.join(' ')}`);
                let proc = cp.spawn('azcopy', args, {shell: true});
                let timeout = setTimeout(() => {
                    proc.kill();
                    showErrorMessageWithHelp(`Failed to synchronize code. Command timeout.`);
                    resolve('timeout');
                }, 60000);
                let lastPercent = 0;
                proc.stdout.on('data', (data) => {
                    let sdata = String(data);
                    outputChannel.append('[CMD OUT] ' + sdata);
                    console.log(`msra_intern_s_toolkit.synchronize: ${sdata}`);
                    if (sdata.includes('Authentication failed')) {
                        proc.kill();
                        clearTimeout(timeout);
                        showErrorMessageWithHelp(`Failed to synchronize code. SAS authentication failed.`);
                        resolve('failed');
                    }
                    else if (/[0-9.]+\s%,\s[0-9]+\sDone,\s[0-9]+\sFailed,\s[0-9]+\sPending,\s[0-9]+\sSkipped,\s[0-9]+\sTotal,\s2-sec\sThroughput\s\(Mb\/s\):\s[0-9.]+/g.test(sdata)) {
                        let percent = Number(sdata.split('%')[0]);
                        progress.report({increment: percent - lastPercent});
                        lastPercent = percent;
                    }
                });
                proc.stderr.on('data', (data) => {
                    let sdata = String(data);
                    outputChannel.append('[CMD ERR] ' + sdata);
                    console.log(`msra_intern_s_toolkit.synchronize: ${sdata}`);
                    if (sdata.includes('not recognized') || sdata.includes('command not found')) {
                        proc.kill();
                        clearTimeout(timeout);
                        showErrorMessageWithHelp(`Failed to synchronize code. Azcopy not found.`);
                        resolve('failed');
                    }
                    else if (sdata.includes('Permission denied')) {
                        proc.kill();
                        clearTimeout(timeout);
                        showErrorMessageWithHelp(`Failed to synchronize code. Permission denied.`);
                        resolve('failed');
                    }
                });
                proc.on('exit', (code) => {
                    clearTimeout(timeout);
                    if (code == 0) {
                        vscode.window.showInformationMessage(`Code synchronized.`);
                        resolve('success');
                    } else if (code != null) {
                        vscode.window.showErrorMessage ('azcopy failed with exit code ' + code);
                        resolve('failed');
                    }
                    else resolve('failed');
                });
            });
        }))(config)
    );
}

export async function submit() {
    return vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        ((cfg) => (async (progress) => {
            progress.report({message: "Submitting the job...", increment: 0});
            return new Promise<string> (async resolve => {
                let passed = await checkCondaEnv(true);
                if (!passed) {
                    resolve('failed');
                    return;
                }

                let cfgPath = `./userdata/temp/submit_jobs_${new Date().getTime()}.json`;
                saveWorkspaceFile(cfgPath, JSON.stringify(cfg, null, 4));

                // First step: upload the config file
                let status1 = await new Promise<string> (resolve1 => {
                    let destination = `"${cfg.storage.sas_token.split('?')[0]}/${cfg.experiment.workdir}/.msra_intern_s_toolkit/userdata/temp/?${cfg.storage.sas_token.split('?')[1]}"`;
                    let args = ['copy', workspacePath(cfgPath), destination];
                    outputChannel.appendLine(`[CMD] > azcopy ${args.join(' ')}`);
                    let proc = cp.spawn('azcopy', args, {shell: true});
                    progress.report({increment: 25});
                    let timeout = setTimeout(() => {
                        proc.kill();
                        showErrorMessageWithHelp(`Failed to submit the job. Command timeout.`);
                        resolve1('timeout');
                    }, 60000);
                    proc.stdout.on('data', (data) => {
                        let sdata = String(data);
                        outputChannel.append('[CMD OUT] ' + sdata);
                        console.log(`msra_intern_s_toolkit.synchronize: ${sdata}`);
                        if (sdata.includes('Authentication failed')) {
                            proc.kill();
                            clearTimeout(timeout);
                            showErrorMessageWithHelp(`Failed to submit the job. SAS authentication failed.`);
                            resolve1('failed');
                        }
                    });
                    proc.stderr.on('data', (data) => {
                        let sdata = String(data);
                        outputChannel.append('[CMD ERR] ' + sdata);
                        console.log(`msra_intern_s_toolkit.synchronize: ${sdata}`);
                        if (sdata.includes('not recognized') || sdata.includes('command not found')) {
                            proc.kill();
                            clearTimeout(timeout);
                            showErrorMessageWithHelp(`Failed to submit the job. Azcopy not found.`);
                            resolve1('failed');
                        }
                        else if (sdata.includes('Permission denied')) {
                            proc.kill();
                            clearTimeout(timeout);
                            showErrorMessageWithHelp(`Failed to submit the job. Permission denied.`);
                            resolve1('failed');
                        }
                    });
                    proc.on('exit', (code) => {
                        clearTimeout(timeout);
                        if (code == 0) {
                            progress.report({increment: 25});
                            resolve1('success');
                        } else if (code != null) {
                            vscode.window.showErrorMessage ('azcopy failed with exit code ' + code);
                            resolve1('failed');
                        }
                        else resolve1('failed');
                    });
                });

                // Second step: submit the job
                if (status1 != 'success') {
                    resolve(status1);
                    return;
                }

                let status2 = await new Promise<string> (resolve2 => {
                    outputChannel.appendLine(`[CMD] > conda run -n msra-intern-s-toolkit python ${globalPath('script/submit_jobs/submit.py')} --config ${workspacePath(cfgPath)}`);
                    let proc = cp.spawn('conda', ['run', '-n', 'msra-intern-s-toolkit', 'python', globalPath('script/submit_jobs/submit.py'), '--config', workspacePath(cfgPath)], {shell: true});
                    progress.report({increment: 25});
                    let timeout = setTimeout(() => {
                        proc.kill();
                        showErrorMessageWithHelp(`Failed to submit the job. Command timeout.`);
                        resolve2('timeout');
                    }, 60000);
                    proc.stdout.on('data', (data) => {
                        let sdata = String(data);
                        outputChannel.appendLine('[CMD OUT] ' + sdata);
                        console.log(`msra_intern_s_toolkit.submit: ${sdata}`);
                        if (sdata.includes('Run(')) {
                            proc.kill();
                            clearTimeout(timeout);
                            let id = sdata.trim().slice(4, -1).split(',')[1].trim().slice(4);
                            vscode.window.showInformationMessage(`Job submitted. Id: ${id}`);
                            progress.report({increment: 25});
                            saveWorkspaceFile(`./userdata/jobs_history/${id}.json`, JSON.stringify(cfg, null, 4));
                            resolve2('success');
                        }
                    });
                    proc.stderr.on('data', (data) => {
                        let sdata = String(data);
                        outputChannel.appendLine('[CMD ERR] ' + sdata);
                        console.error(`msra_intern_s_toolkit.submit: ${sdata}`);
                    });
                    proc.on('exit', (code) => {
                        clearTimeout(timeout);
                        if (code != null) {
                            showErrorMessageWithHelp(`Failed to submit the job. Unknown reason. code ${code}`);
                            resolve2('failed');
                        }
                        console.log(`msra_intern_s_toolkit.submit: Process exited with ${code}`);
                    });
                });

                resolve(status2);
            });
        }))(config)
    );
}

export function updateConfig(group: string, label: string, value: any) {
    (config as any)[group][label] = value;
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
}

function loadJson(path: string) {
    if (workspaceExists(path)) {
        config = new JobConfig(JSON.parse(getWorkspaceFile(path)));
    }
    else {
        config = new JobConfig();
    }
}

async function loadHistory() {
    let res = await vscode.window.showQuickPick(
        listWorkspaceFiles('userdata/jobs_history')
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
    loadJson(`./userdata/jobs_history/${res}.json`);
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
    refreshUI();
}

async function loadSaved() {
    let res = await vscode.window.showQuickPick(
        listWorkspaceFiles('userdata/saved_jobs')
            .map((v) => v.slice(0, -5)), {
        title: 'Select job config',
        canPickMany: false,
        ignoreFocusOut: true
    });
    if (res == undefined) return;
    loadJson(`./userdata/saved_jobs/${res}.json`);
    refreshUI();
}

export async function load() {
    let res = await vscode.window.showQuickPick(
        ['History', 'Saved'], {
        title: 'Select job config',
        canPickMany: false,
        ignoreFocusOut: true
    });
    if (res == undefined) return;
    if (res == 'History') loadHistory();
    else if (res == 'Saved') loadSaved();
}

export async function save() {
    let res = await vscode.window.showInputBox({
        title: 'Save job config',
        prompt: 'Enter a name for the config',
        ignoreFocusOut: true
    });
    if (res == undefined) return;
    // Check if the file exists
    if (workspaceExists(`./userdata/saved_jobs/${res}.json`)) {
        let overwrite = await vscode.window.showQuickPick(
            ['Yes', 'No'], {
            title: `Config ${res} already exists. Overwrite?`,
            canPickMany: false,
            ignoreFocusOut: true
        });
        if (overwrite != 'Yes') return;
    }
    saveWorkspaceFile(`./userdata/saved_jobs/${res}.json`, JSON.stringify(config, null, 4));
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
        outputChannel.appendLine('[CMD] > conda env list');
        cp.exec('conda env list', (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                let passed = stdout.includes('msra-intern-s-toolkit');
                if (!passed) {
                    if (showErrorMsg) showErrorMessageWithHelp(`Failed to submit the job. Conda environment not found.`);
                    showSetupCondaEnvMessage();
                }
                resolve(passed);
            }
            else if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
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
                outputChannel.appendLine('[CMD] > conda env create -f script/environment.yml');
                let proc = cp.spawn('conda', ['env', 'create', '-f', globalPath('script/environment.yml')], {shell: true});
                proc.stdout.on('data', (data) => {
                    let sdata = String(data);
                    outputChannel.appendLine('[CMD OUT] ' + sdata);
                    if (sdata.includes('conda activate msra-intern-s-toolkit')) {
                        vscode.window.showInformationMessage(`Conda environment setup done.`);
                        resolve();
                    }
                });
                proc.stderr.on('data', (data) => {
                    let sdata = String(data);
                    outputChannel.appendLine('[CMD ERR] ' + sdata);
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
    outputChannel.appendLine('[INFO] Initializing job submission module...');
    if (vscode.workspace.workspaceFolders) {
        outputChannel.appendLine('[INFO] Workspace folder found.');
        checkCondaEnv();
        loadJson('./userdata/submit_jobs.json');
    }
    else {
        outputChannel.appendLine('[INFO] No workspace folder found.');
    };

    ui = new SubmitJobsView();
    vscodeContext.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'msra_intern_s_toolkit_view_submitJobs',
        ui,
        {webviewOptions: {retainContextWhenHidden: true}}
    ));
}

export function refreshUI() {
    if (ui != undefined) {
        if (!vscode.workspace.workspaceFolders) ui.noWorkspace();
        else ui.setContent(config);
    }
}
