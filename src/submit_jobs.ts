import * as vscode from 'vscode';
import * as cp from 'child_process'
import * as fs from 'fs'
import * as parsec from 'typescript-parsec'
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


// Arg Sweep Parsing
namespace ArgSweepParser {
    enum TokenKind {
        Literal,
        Range,
        Item,
        Colon,
        LParen,
        RParen,
        Separator,
        Space,
    }

    const lexer = parsec.buildLexer([
        [true, /^(['"])(?:(?=(\\?))\2.)*?\1/g, TokenKind.Literal],
        [true, /^[0-9]+-[0-9]+/g, TokenKind.Range],
        [true, /^[^\s,:\(\)]+/g, TokenKind.Item],
        [true, /^:(?:[^\S\r\n]*(?:\r?\n|\r))?/g, TokenKind.Colon],
        [true, /^\(/g, TokenKind.LParen],
        [true, /^\)/g, TokenKind.RParen],
        [true, /^,(?:[^\S\r\n]*(?:\r?\n|\r))?|^(?:\r?\n|\r)/g, TokenKind.Separator],
        [false, /^[^\S\r\n]/g, TokenKind.Space],
    ]);

    const Item = parsec.rule<TokenKind, {type: string, values: string}>();
    Item.setPattern(
        parsec.apply(
            parsec.alt(parsec.tok(TokenKind.Literal), parsec.tok(TokenKind.Item)),
            (value) => {
                let item;
                if (value.kind == TokenKind.Literal) item = value.text.slice(1, -1);
                else item = value.text;
                return {type: 'Item', values: item};
            }
        )
    );
    
    const Tuple = parsec.rule<TokenKind, {type: string, values: string[]}>();
    Tuple.setPattern(
        parsec.apply(
            parsec.seq(
                parsec.tok(TokenKind.LParen),
                parsec.list_sc(Item, parsec.str(',')),
                parsec.tok(TokenKind.RParen),
            ),
            (value) => {
                let res: string[] = [];
                for (let v of value[1]) {
                    res.push(v.values);
                }
                return {type: 'Tuple', values: res};
            }
        )
    );

    const Range = parsec.rule<TokenKind, {type: string, values: string[]}>();
    Range.setPattern(
        parsec.apply(
            parsec.tok(TokenKind.Range),
            (value) => {
                let s = value.text.split('-');
                let start = parseInt(s[0]);
                let end = parseInt(s[1]);
                let res = [];
                for (let i = start; i <= end; i++) {
                    res.push(`${i}`);
                }
                return {type: 'Range', values: res};
            }
        )
    );

    const Argname = parsec.rule<TokenKind, {type: string, values: string | string[]}>();
    Argname.setPattern(
        parsec.apply(
            parsec.seq(
                parsec.alt(Item, Tuple),
                parsec.tok(TokenKind.Colon),
            ),
            (value) => {
                return {type: 'Argname', values: value[0].values};
            }
        )
    );

    const Parser = parsec.rule<TokenKind, {name: string | string[], values: (string | string[])[]}[]>();
    Parser.setPattern(
        parsec.apply(
            parsec.seq(
                parsec.rep_sc(
                    parsec.alt_sc(
                        parsec.kright(parsec.opt_sc(parsec.rep_sc(parsec.tok(TokenKind.Separator))), Argname),
                        parsec.kleft(Tuple, parsec.tok(TokenKind.Separator)),
                        parsec.kleft(Range, parsec.tok(TokenKind.Separator)),
                        parsec.kleft(Item, parsec.tok(TokenKind.Separator)),
                    ),
                ),
                parsec.opt_sc(parsec.alt_sc(Tuple, Range, Item)),
                parsec.opt_sc(parsec.rep_sc(parsec.tok(TokenKind.Separator))),
            ),
            (value) => {
                let res: {name: string | string[], values: (string | string[])[]}[] = [];
                if (value[1]) value[0].push(value[1]);
                for (let v of value[0]) {
                    switch (v.type) {
                        case 'Argname':
                            res.push({name: v.values, values: []});
                            break;
                        case 'Tuple':
                            res[res.length-1].values.push(v.values);
                            break;
                        case 'Range':
                            res[res.length-1].values = res[res.length-1].values.concat(v.values);
                            break;
                        case 'Item':
                            res[res.length-1].values.push(v.values);
                            break;
                    }
                }
                return res;
            }
        )
    );

    export function getAllTokens(s: string): parsec.Token<TokenKind>[] {
        let tokens = [];
        let token = lexer.parse(s);
        while (token) {
            tokens.push(token);
            token = token.next;
        }
        return tokens;
    }

    export function parse(s: string): {name: string, value: string}[][] {
        // Parse the input string into a list of arg-value pairs
        let tokens = lexer.parse(s);

        let res = parsec.expectEOF(Parser.parse(tokens));
        if (res.successful === false || res.candidates.length != 1) {
            console.log('msra_intern_s_toolkit.ArgSweepParser: Parsing failed');
            console.log(res);
            showErrorMessageWithHelp(`Job submission failed. Invalid Arg Sweep format.`);
            return [];
        }
        let args: {name: string | string[], values: (string | string[])[]}[] = res.candidates[0].result;
        
        // Generate all combinations
        let all_combinations: {name: string, value: string}[][] = [];
        let dfs = (idx: number, current: {name: string, value: string}[]) => {
            if (idx == args.length) {
                all_combinations.push(current);
                return;
            }
            for (let v of args[idx].values) {
                let current_ = deepCopy(current);
                if (Array.isArray(args[idx].name)) {
                    for (let i = 0; i < args[idx].name.length; i++) {
                        current_.push({'name': args[idx].name[i], 'value': v[i]});
                    }
                }
                else {
                    current_.push({'name': args[idx].name, 'value': v});
                }
                dfs(idx+1, current_);
            }
        }
        dfs(0, []);
        console.log('msra_intern_s_toolkit.ArgSweepParser: Parsing succeeded');
        console.log(all_combinations);
        return all_combinations;
    }
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
                fs.copyFileSync(workspacePath(cfgPath), workspacePath(`./userdata/jobs_history/${info.displayName}_${new Date().getTime()}.json`));
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

    let argSweep = cfg.experiment.arg_sweep.filter((v) => v.trim() != '').join('\n').trim();
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
        let argSweepParsed = ArgSweepParser.parse(argSweep);
        if (argSweepParsed.length == 0) return 'failed';
        return vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false}, 
            (async (progress) => {
                progress.report({message: "Submitting sweep jobs...", increment: 0});
                let increment = 100 / (argSweepParsed.length + 1);

                let passed = await checkCondaEnv(true);
                if (!passed) return 'failed';

                let cfgFileBase = `submit_jobs_${new Date().getTime()}_sweep`;
                let cfgPaths = [];
                for (let i = 0; i < argSweepParsed.length; i++) {
                    let sweep_cfg: JobConfig = deepCopy(cfg);
                    sweep_cfg.experiment.arg_sweep = [];
                    for (let arg of argSweepParsed[i]) {
                        for (let j = 0; j < sweep_cfg.experiment.script.length; j++) {
                            sweep_cfg.experiment.script[j] = sweep_cfg.experiment.script[j].replaceAll(`\${{${arg.name}}}`, arg.value);
                        }
                        sweep_cfg.experiment.job_name = sweep_cfg.experiment.job_name.replaceAll(`\${{${arg.name}}}`, arg.value);
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
    if (res == 'History') await loadHistory();
    else if (res == 'Saved') await loadSaved();
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
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
