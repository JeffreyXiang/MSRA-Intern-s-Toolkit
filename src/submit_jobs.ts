import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as fs from 'fs'
import {vscodeContext, outputChannel} from './extension'
import {SubmitJobsView} from './ui/submit_jobs'
import {showErrorMessageWithHelp, deepCopy} from './utils'
import {globalPath, workspacePath, workspaceExists, saveWorkspaceFile, getWorkspaceFile, listWorkspaceFiles} from './helper/file_utils'
import * as azureml from './helper/azureml'

class ClusterConfig {
    workspace: string = ''
    workspace_subscription_id: string = ''
    workspace_resource_group: string = ''
    virtual_cluster: string = 'msroctovc'
    virtual_cluster_subscription_id: string = ''
    virtual_cluster_resource_group: string = ''
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
    setup_script: string[] = []
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
    script: string[] = []
    arg_sweep: string[] = []
}

export class JobConfig {
    cluster: ClusterConfig = new ClusterConfig();
    storage: StorageConfig = new StorageConfig();
    environment: EnvironmentConfig = new EnvironmentConfig();
    experiment: ExperimentConfig = new ExperimentConfig();
    
    constructor(init?: any) {
        if (init === undefined) return;

        if (init.cluster !== undefined) {
            if (init.cluster.workspace !== undefined) this.cluster.workspace = init.cluster.workspace;
            if (init.cluster.workspace_subscription_id !== undefined) this.cluster.workspace_subscription_id = init.cluster.workspace_subscription_id;
            if (init.cluster.workspace_resource_group !== undefined) this.cluster.workspace_resource_group = init.cluster.workspace_resource_group;
            if (init.cluster.virtual_cluster !== undefined) this.cluster.virtual_cluster = init.cluster.virtual_cluster;
            if (init.cluster.virtual_cluster_subscription_id !== undefined) this.cluster.virtual_cluster_subscription_id = init.cluster.virtual_cluster_subscription_id;
            if (init.cluster.virtual_cluster_resource_group !== undefined) this.cluster.virtual_cluster_resource_group = init.cluster.virtual_cluster_resource_group;
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
            if (init.experiment.arg_sweep !== undefined) this.experiment.arg_sweep = init.experiment.arg_sweep;
        }

        // v1.2 convertion
        if (typeof this.environment.setup_script === 'string') this.environment.setup_script = (this.environment.setup_script as string).split('\n');
        if (typeof this.experiment.script === 'string') this.experiment.script = (this.experiment.script as string).split('\n');

        // v1.3 convertion
        if (init.experiment.sas_token) this.storage.sas_token = init.experiment.sas_token;
    }
}

export class Resource {
    workspaces: azureml.Workspace[] = [];
    virtualClusters: azureml.VirtualCluster[] = [];
    images: azureml.Image[] = [];

    constructor(init?: any) {
        if (init === undefined) return;

        if (init.workspaces !== undefined) this.workspaces = init.workspaces;
        if (init.virtualClusters !== undefined) this.virtualClusters = init.virtualClusters;
        if (init.images !== undefined) this.images = init.images;
    }
}

var config: JobConfig;
var resource: Resource;

export var ui: SubmitJobsView;

function isRange(s: string): boolean {
    if (!s.includes('-')) return false;
    if (s.indexOf('-') != s.lastIndexOf('-')) return false;
    let start = s.slice(0, s.indexOf('-')).trim();
    let end = s.slice(s.indexOf('-')+1).trim();
    if (start.match(/[0-9]+/) && end.match(/[0-9]+/)) return true;
    return false;
}

function parseRange(s: string): string[] {
    let split = s.split('-');
    let start = parseInt(split[0]);
    let end = parseInt(split[1]);
    let res = [];
    for (let i = start; i <= end; i++) {
        res.push(`${i}`);
    }
    return res;
}

function parseArgSweep(arg_sweep: string | string[]): {name: string, value: string}[][] {
    if (typeof arg_sweep === 'string') arg_sweep = [arg_sweep];
    let arg_sweep_parsed: {name: string, values: string[]}[] = [];
    for (let s of arg_sweep) {
        let idx = s.indexOf(':');
        if (idx == -1) {
            showErrorMessageWithHelp(`Job submission failed. Invalid Arg Sweep format.`);
            return [];
        }
        let name = s.slice(0, idx).trim();
        let values = s.slice(idx+1).split(',').map((v) => v.trim())
        let values_parsed: string[] = [];
        for (let v of values) {
            if (isRange(v)) values_parsed = values_parsed.concat(parseRange(v));
            else values_parsed.push(v);
        }
        arg_sweep_parsed.push({'name': name, 'values': values_parsed});
    }
    let all_combinations: {name: string, value: string}[][] = [];
    let dfs = (idx: number, current: {name: string, value: string}[]) => {
        if (idx == arg_sweep_parsed.length) {
            all_combinations.push(current);
            return;
        }
        for (let v of arg_sweep_parsed[idx].values) {
            dfs(idx+1, current.concat({'name': arg_sweep_parsed[idx].name, 'value': v}));
        }
    }
    dfs(0, []);
    return all_combinations;
}

export async function synchronize(jobcfg?: JobConfig) {
    let cfg: JobConfig = jobcfg ? jobcfg : deepCopy(config);
    return vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
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
        })
    );
}

export async function uploadConfig(cfgPath: string, destination: string) {
    return await new Promise<string> (resolve1 => {
        let source = `"${workspacePath(cfgPath)}"`;
        let args = ['copy', source, destination];
        outputChannel.appendLine(`[CMD] > azcopy ${args.join(' ')}`);
        let proc = cp.spawn('azcopy', args, {shell: true});
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
                resolve1('success');
            } else if (code != null) {
                vscode.window.showErrorMessage ('azcopy failed with exit code ' + code);
                resolve1('failed');
            }
            else resolve1('failed');
        });
    });
}

export async function submitToAML(cfgPath: string) {
    return new Promise<string> (resolve => {
        outputChannel.appendLine(`[CMD] > conda run -n msra-intern-s-toolkit python "${globalPath('script/submit_jobs/submit.py')}" --config "${workspacePath(cfgPath)}"`);
        let proc = cp.spawn('conda', ['run', '-n', 'msra-intern-s-toolkit', 'python', `"${globalPath('script/submit_jobs/submit.py')}"`, '--config', `"${workspacePath(cfgPath)}"`], {shell: true});
        let timeout = setTimeout(() => {
            proc.kill();
            showErrorMessageWithHelp(`Failed to submit the job. Command timeout.`);
            resolve('timeout');
        }, 60000);
        proc.stdout.on('data', (data) => {
            let sdata = String(data);
            outputChannel.appendLine('[CMD OUT] ' + sdata);
            console.log(`msra_intern_s_toolkit.submit: ${sdata}`);
            if (sdata.includes('Job Submitted')) {
                let info = JSON.parse(sdata.slice(sdata.indexOf('{')));
                vscode.window.showInformationMessage(`${info.displayName} submitted.`, 'View in AML Studio').then((choice) => {
                    if (choice == 'View in AML Studio') vscode.env.openExternal(vscode.Uri.parse(info.studioUrl));
                });
                fs.copyFileSync(workspacePath(cfgPath), `./userdata/jobs_history/${info.displayName}_${new Date().getTime()}.json`);
                resolve('success');
            }
        });
        proc.stderr.on('data', (data) => {
            let sdata = String(data);
            outputChannel.appendLine('[CMD ERR] ' + sdata);
            console.error(`msra_intern_s_toolkit.submit: ${sdata}`);
        });
        proc.on('exit', (code) => {
            clearTimeout(timeout);
            if (code != undefined && code != 0) {
                showErrorMessageWithHelp(`Failed to submit the job. Unknown reason. code ${code}`);
                resolve('failed');
            }
            console.log(`msra_intern_s_toolkit.submit: Process exited with ${code}`);
        });
    });
}

export async function submit() {
    let cfg: JobConfig = deepCopy(config);

    if (cfg.experiment.sync_code) {
        let sync = await synchronize(cfg);
        if (sync == 'failed') return 'failed';
    }

    let argSweep = cfg.experiment.arg_sweep.filter((v) => v.trim() != '');
    if (argSweep.length == 0) {
        return vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false}, 
            (async (progress) => {
                progress.report({message: "Submitting the job...", increment: 0});
                let passed = await checkCondaEnv(true);
                if (!passed) return 'failed';        
    
                let cfgPath = `./userdata/temp/submit_jobs_${new Date().getTime()}.json`;
                saveWorkspaceFile(cfgPath, JSON.stringify(cfg, null, 4));

                // First step: upload the config file
                let destination = `"${cfg.storage.sas_token.split('?')[0]}/${cfg.experiment.workdir}/.msra_intern_s_toolkit/userdata/temp/?${cfg.storage.sas_token.split('?')[1]}"`;
                let status1 = await uploadConfig(cfgPath, destination);
                if (status1 != 'success') return status1;
                progress.report({increment: 50});

                // Second step: submit the job
                let status2 = await submitToAML(cfgPath);
                progress.report({increment: 50});
                return status2;
            })
        );
    }
    else {
        let argSweepParsed = parseArgSweep(argSweep);
        if (argSweepParsed.length == 0) return 'failed';
        return vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false}, 
            (async (progress) => {
                progress.report({message: "Submitting sweep jobs...", increment: 0});
                let increment = 100 / argSweepParsed.length;

                let passed = await checkCondaEnv(true);
                if (!passed) return 'failed';

                let cfgFileBase = `submit_jobs_${new Date().getTime()}_sweep`;
                let cfgPaths = [];
                for (let i = 0; i < argSweepParsed.length; i++) {
                    let sweep_cfg = deepCopy(cfg);
                    for (let arg of argSweepParsed[i]) {
                        for (let j = 0; j < sweep_cfg.experiment.script.length; j++) {
                            sweep_cfg.experiment.script[j] = sweep_cfg.experiment.script[j].replace(`\${{${arg.name}}}`, arg.value);
                        }
                        sweep_cfg.experiment.job_name = sweep_cfg.experiment.job_name.replace(`\${{${arg.name}}}`, arg.value);
                    }
                    let cfgPath = `./userdata/temp/${cfgFileBase}_${i}.json`;
                    saveWorkspaceFile(cfgPath, JSON.stringify(sweep_cfg, null, 4));
                    cfgPaths.push(cfgPath);
                }

                // First step: upload the config files
                let destination = `"${cfg.storage.sas_token.split('?')[0]}/${cfg.experiment.workdir}/.msra_intern_s_toolkit/userdata/temp/?${cfg.storage.sas_token.split('?')[1]}"`;
                let status1 = await uploadConfig(`./userdata/temp/${cfgFileBase}_*.json`, destination);
                if (status1 != 'success') return status1;
                progress.report({message: `(0/${cfgPaths.length}) Submitting sweep jobs...`, increment: increment});

                // Second step: submit the jobs
                for (let i = 0; i < cfgPaths.length; i++) {
                    let status2 = await submitToAML(cfgPaths[i]);
                    if (status2 != 'success') return status2;
                    progress.report({message: `(${i+1}/${cfgPaths.length}) Submitting sweep jobs...`, increment: increment});
                }
                saveWorkspaceFile(`./userdata/jobs_history/${cfg.experiment.name}_${new Date().getTime()}_sweep.json`, JSON.stringify(cfg, null, 4));
            })
        );
    }
}

export function updateConfig(group: string, label: string, value: any) {
    (config as any)[group][label] = value;
    if (group == 'cluster') {
        if (label == 'workspace') {
            let ws = resource.workspaces.find((v) => v.name == value);
            if (ws) {
                config.cluster.workspace_subscription_id = ws.subscriptionId;
                config.cluster.workspace_resource_group = ws.resourceGroup;
            }
        }
        else if (label == 'virtual_cluster') {
            let vc = resource.virtualClusters.find((v) => v.name == value);
            if (vc) {
                config.cluster.virtual_cluster_subscription_id = vc.subscriptionId;
                config.cluster.virtual_cluster_resource_group = vc.resourceGroup;
            }
        }
    }
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
}

function loadConfig(path: string) {
    if (workspaceExists(path)) {
        config = new JobConfig(JSON.parse(getWorkspaceFile(path)));
    }
    else {
        config = new JobConfig();
    }
}

function loadResourceCache() {
    let cachePath = './userdata/resource_cache.json';
    if (workspaceExists(cachePath)) {
        resource = new Resource(JSON.parse(getWorkspaceFile(cachePath)));
    }
    else {
        resource = new Resource();
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
    loadConfig(`./userdata/jobs_history/${res}.json`);
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
    refreshUI({config: config});
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
    loadConfig(`./userdata/saved_jobs/${res}.json`);
    refreshUI({config: config});
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
                let proc = cp.spawn('conda', ['env', 'create', '-f', `"${globalPath('script/environment.yml')}"`], {shell: true});
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

export async function getComputeResources() {
    let res = await Promise.all([azureml.REST.getWorkspaces(), azureml.REST.getVirtualClusters(), azureml.REST.getImages()]);
    resource.workspaces = res[0];
    resource.virtualClusters = res[1];
    resource.images = res[2];
    azureml.findDefaultWorkspace(resource.workspaces, resource.virtualClusters);
    saveWorkspaceFile('./userdata/resource_cache.json', JSON.stringify(resource, null, 4));
}

export class uiParams {
    config?: JobConfig;
    resource?: {workspaces: azureml.Workspace[], virtualClusters: azureml.VirtualCluster[]};
}

export function refreshUI(params?: uiParams) {
    console.log(params);
    if (params == undefined) params = {config: config, resource: resource};
    if (ui != undefined) {
        if (!vscode.workspace.workspaceFolders) ui.noWorkspace();
        else ui.setContent(params);
    }
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing job submission module...');
    if (vscode.workspace.workspaceFolders) {
        outputChannel.appendLine('[INFO] Workspace folder found.');
        checkCondaEnv();
        loadConfig('./userdata/submit_jobs.json');
        loadResourceCache();
        if (resource.workspaces.length == 0 || resource.virtualClusters.length == 0 || resource.images.length == 0) {
            vscode.commands.executeCommand('msra_intern_s_toolkit.refreshSubmitJobsView');
        }
    }
    else {
        outputChannel.appendLine('[INFO] No workspace folder found.');
    };

    vscodeContext.subscriptions.push(vscode.commands.registerCommand('msra_intern_s_toolkit.refreshSubmitJobsView', () => {
        // show waiting info
        vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false},
            (() => (async (progress) => {
                progress.report({message: "Fetching compute resources info..."});
                await getComputeResources();
                refreshUI({resource: resource});
            }))()
        );
    }));

    ui = new SubmitJobsView();
    vscodeContext.subscriptions.push(vscode.window.registerWebviewViewProvider(
        'msra_intern_s_toolkit_view_submitJobs',
        ui,
        {webviewOptions: {retainContextWhenHidden: true}}
    ));
}
