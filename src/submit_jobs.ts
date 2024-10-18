import * as vscode from 'vscode';
import * as parsec from 'typescript-parsec'
import * as cp from 'child_process';
import {vscodeContext, outputChannel} from './extension'
import {showErrorMessageWithHelp, deepCopy, randomString} from './utils'
import {workspacePath, workspaceExists, saveWorkspaceFile, getWorkspaceFile, listWorkspaceFiles, exists, saveFile, getFile} from './helper/file_utils'
import * as profile from './profile'
import * as azure from './helper/azure'

class ClusterConfig {
    workspace: string = '';
    virtual_cluster: string = 'msroctovc';
    instance_type: string = '';
    node_count: number = 1;
    sla_tier: string = 'Basic';
    location: string[] | undefined = undefined;
}

export enum IOMode {
    RO_MOUNT = 'ro_mount',
    RW_MOUNT = 'rw_mount',
    DOWNLOAD = 'download',
    UPLOAD = 'upload',
}

export class IOConfig {
    name: string = '';
    datastore: string = '';
    path: string = '';
    mode: IOMode = IOMode.RW_MOUNT;
}

export class SynchronizationConfig {
    target: string = '';
    ignore_dir: string = '';
}

export class EnvironmentConfig {
    image: string = '';
}

export class ExperimentConfig {
    name: string = '';
    job_name: string = '';
    managed_id: string | undefined = undefined;
    script: string[] = [];
    arg_sweep: string[] = [];
}

export class JobConfig {
    cluster: ClusterConfig = new ClusterConfig();
    io: IOConfig[] = [];
    synchronization: SynchronizationConfig = new SynchronizationConfig();
    environment: EnvironmentConfig = new EnvironmentConfig();
    experiment: ExperimentConfig = new ExperimentConfig();
    
    constructor(init?: any) {
        if (init === undefined) return;

        if (init.cluster !== undefined) {
            if (init.cluster.workspace !== undefined) this.cluster.workspace = init.cluster.workspace;
            if (init.cluster.virtual_cluster !== undefined) this.cluster.virtual_cluster = init.cluster.virtual_cluster;
            if (init.cluster.instance_type !== undefined) this.cluster.instance_type = init.cluster.instance_type;
            if (init.cluster.node_count !== undefined) this.cluster.node_count = init.cluster.node_count;
            if (init.cluster.sla_tier !== undefined) this.cluster.sla_tier = init.cluster.sla_tier;
            if (init.cluster.location !== undefined) this.cluster.location = init.cluster.location;
        }

        if (init.io !== undefined) {
            for (let i of init.io) {
                let io = new IOConfig();
                if (i.name !== undefined) io.name = i.name;
                if (i.datastore !== undefined) io.datastore = i.datastore;
                if (i.path !== undefined) io.path = i.path;
                if (i.mode !== undefined) io.mode = i.mode;
                this.io.push(io);
            }
        }

        if (init.synchronization !== undefined) {
            if (init.synchronization.target !== undefined) this.synchronization.target = init.synchronization.target;
            if (init.synchronization.ignore_dir !== undefined) this.synchronization.ignore_dir = init.synchronization.ignore_dir;
        }

        if (init.environment !== undefined) {
            if (init.environment.image !== undefined) this.environment.image = init.environment.image;
        }

        if (init.experiment !== undefined) {
            if (init.experiment.name !== undefined) this.experiment.name = init.experiment.name;
            if (init.experiment.job_name !== undefined) this.experiment.job_name = init.experiment.job_name;
            if (init.experiment.managed_id !== undefined) this.experiment.managed_id = init.experiment.managed_id;
            if (init.experiment.script !== undefined) this.experiment.script = init.experiment.script;
            if (init.experiment.arg_sweep !== undefined) this.experiment.arg_sweep = init.experiment.arg_sweep;
        }

        // v1.2 convertion
        if (typeof this.experiment.script === 'string') this.experiment.script = (this.experiment.script as string).split('\n');

        // v2 convertion
        if (init.environment !== undefined && init.environment.docker_image !== undefined) {
            this.environment.image = init.environment.docker_image;
        }
    }
}

export class Resource {
    workspaces: azure.ml.Workspace[] = [];
    virtualClusters: azure.ml.VirtualCluster[] = [];
    datastores: azure.ml.Datastore[] = [];
    managedIdentities: azure.managed_identity.UserAssignedIdentity[] = [];

    constructor(init?: any) {
        if (init === undefined) return;

        if (init.workspaces !== undefined) this.workspaces = init.workspaces.map(
            (v: any) => azure.ml.Workspace.fromJSON(v)
        );
        if (init.virtualClusters !== undefined) this.virtualClusters = init.virtualClusters.map(
            (v: any) => azure.ml.VirtualCluster.fromJSON(v)
        );
        if (init.datastores !== undefined) this.datastores = init.datastores.map(
            (v: any) => azure.ml.Datastore.fromJSON(v)
        );
        if (init.managedIdentities !== undefined) this.managedIdentities = init.managedIdentities.map(
            (v: any) => azure.managed_identity.UserAssignedIdentity.fromJSON(v)
        );
    }
}

var config: JobConfig = new JobConfig();
var resource: Resource = new Resource();

import {SubmitJobsView} from './ui/submit_jobs'
export var ui: SubmitJobsView;
export var activeProfile: profile.Profile | undefined = undefined;


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

async function getComputeResources() {
    return await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (() => (async (progress) => {
            progress.report({message: "Fetching compute resources info..."});
            let res;
            try {
                res = await Promise.all([
                    azure.ml.getWorkspaces(activeProfile!.azureConfigDir),
                    azure.ml.getVirtualClusters(activeProfile!.azureConfigDir),
                    azure.managed_identity.getUserAssignedIdentities(activeProfile!.azureConfigDir),
                ]);
            } catch (err) {
                showErrorMessageWithHelp(`Failed to get compute resources. ${err}`);
                throw 'failed_to_get_compute_resources';
            }
            resource.workspaces = res[0];
            resource.virtualClusters = res[1];
            resource.managedIdentities = res[2];
            azure.ml.findDefaultWorkspace(resource.workspaces, resource.virtualClusters);
            saveResourceCache();
            return 'success';
        }))()
    );
}

async function selectDatastore(prompt?: string) {
    let datastores = resource.datastores.map((v) => v.name);
    let selected = await vscode.window.showQuickPick(datastores, {title: prompt ? prompt : 'Select datastore', ignoreFocusOut: true});
    if (selected === undefined) return;
    return resource.datastores.find((v) => v.name == selected);
}

async function setDatastoreAuth(datastore: azure.ml.Datastore, overwrite: boolean = true) {
    let selected = await vscode.window.showQuickPick(['Account Key', 'Shared Access Signature', 'Identity'], {title: 'Select authentication method', ignoreFocusOut: true});
    if (selected === undefined) return;
    switch (selected) {
        case 'Account Key':
            if (!overwrite && datastore.blobContainer.storageAccount.key) {
                datastore.authType = 'key';
            }
            else {
                let key = await vscode.window.showInputBox({prompt: 'Enter the account key', ignoreFocusOut: true});
                if (key === undefined) return;
                datastore.authType = 'key';
                datastore.blobContainer.storageAccount.key = key;
            }
            break;
        case 'Shared Access Signature':
            datastore.authType = 'sas';
            break;
        case 'Identity':
            datastore.authType = 'identity';
            break;
    }
    selected = await vscode.window.showQuickPick(['Yes', 'No'], {title: 'Allow workspace managed identity access?', ignoreFocusOut: true});
    if (selected === undefined) return;
    datastore.allowWorkspaceManagedIdentityAccess = selected == 'Yes';
    return datastore;
}

async function newDatastore() {
    // Get the way to connect to the storage account
    let selected = await vscode.window.showQuickPick(['Account Key', 'User Identity'], {title: 'Select connection method to Azure Storage Account', ignoreFocusOut: true});
    if (selected === undefined) return;
    let storageAcount: azure.storage.StorageAccount;
    if (selected == 'Account Key') {
        let name = await vscode.window.showInputBox({prompt: 'Enter the name of the storage account', ignoreFocusOut: true});
        if (name === undefined) return;
        let key = await vscode.window.showInputBox({prompt: 'Enter the key of the storage account', ignoreFocusOut: true});
        if (key === undefined) return;
        storageAcount = azure.storage.StorageAccount.fromKey(name, key);
    }
    else {
        // Get subscriptions
        let subscriptions = await vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false},
            (async (progress) => {
                progress.report({message: "Fetching subscriptions..."});
                try {
                    return await azure.account.getSubscriptions(true, activeProfile!.azureConfigDir);
                } catch (err) {
                    showErrorMessageWithHelp('Failed to get subscriptions.');
                }
            })
        );
        if (subscriptions === undefined) return;
        selected = await vscode.window.showQuickPick(subscriptions.map((v) => v.name), {title: 'Select subscription to get storage account', ignoreFocusOut: true});
        if (selected === undefined) return;
        let subscription = subscriptions.find((v) => v.name == selected)!;
        // Get Storage Accounts
        let storageAcounts = await vscode.window.withProgress(
            {location: vscode.ProgressLocation.Notification, cancellable: false},
            (async (progress) => {
                progress.report({message: "Fetching storage accounts..."});
                try {
                    return await azure.storage.getAccounts(subscription.id, activeProfile!.azureConfigDir);
                } catch (err) {
                    showErrorMessageWithHelp('Failed to get storage accounts.');
                }
            })
        );
        if (storageAcounts === undefined) return;
        selected = await vscode.window.showQuickPick(storageAcounts.map((v) => v.name), {title: 'Select storage account', ignoreFocusOut: true});
        if (selected === undefined) return;
        storageAcount = storageAcounts.find((v) => v.name == selected)!;
    }
    // Get Blob Containers
    let containers = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Fetching blob containers..."});
            try {
                return await storageAcount.getContainers();
            } catch (err) {
                showErrorMessageWithHelp('Failed to get containers.');
            }
        })
    );
    if (containers === undefined) return;
    selected = await vscode.window.showQuickPick(containers.map((v) => v.name), {title: 'Select container', ignoreFocusOut: true});
    if (selected === undefined) return;
    let container = containers.find((v) => v.name == selected)!;
    // Get the name of the new datastore
    let defaultName = `datastore_${randomString(10)}`;
    let name = await vscode.window.showInputBox({prompt: 'Enter the name of the new datastore', ignoreFocusOut: true, value: defaultName});
    if (name === undefined) return;
    // Set the auth type
    let newDatastore = await setDatastoreAuth(new azure.ml.Datastore(name, container, 'identity'), false);
    if (newDatastore === undefined) return;
    // Create the datastore
    resource.datastores.push(newDatastore);
    return 'success';
}

async function updateDatastore() {
    let datastore = await selectDatastore('Select the datastore to update');
    if (datastore === undefined) return;
    let updated = await setDatastoreAuth(datastore, true);
    if (updated === undefined) return;
    return 'success';
}

async function deleteDatastore() {
    let datastore = await selectDatastore('Select the datastore to delete');
    if (datastore === undefined) return;
    let idx = resource.datastores.indexOf(datastore);
    resource.datastores.splice(idx, 1);
    return 'success';
}

export async function manageDatastores() {
    let selected = await vscode.window.showQuickPick(['New', 'Update', 'Delete'], {title: 'Select action', ignoreFocusOut: true});
    if (selected === undefined) return;
    let status;
    switch (selected) {
        case 'New':
            status = await newDatastore();
            break;
        case 'Update':
            status = await updateDatastore();
            break;
        case 'Delete':
            status = await deleteDatastore();
            break;
    }
    if (status === 'success') {
        saveResourceCache();
        vscode.window.showInformationMessage('Datastore updated.');
        refreshUI({resource: resource});
    }
}

async function showInstallAzureMLExtension() {
    let selected = await vscode.window.showInformationMessage('Install Azure ML extension?', 'Yes', 'No');
    if (selected !== 'Yes') return;
    return vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Installing Azure ML extension..."});
            try {
                await azure.extension.add('ml', undefined, undefined, activeProfile!.azureConfigDir);
                vscode.window.showInformationMessage('Azure ML extension installed.');
            } catch (err) {
                showErrorMessageWithHelp('Failed to install Azure ML extension.');
            }
        })
    );
}

export async function synchronize(jobcfg?: JobConfig) {
    let cfg: JobConfig = jobcfg ? jobcfg : deepCopy(config);
    if (cfg.synchronization.target == '') {
        vscode.window.showInformationMessage('Please select a target io.');
        throw 'no_target_io';
    }
    let targetIO = cfg.io.find((v) => v.name == cfg.synchronization.target);
    if (!targetIO) {
        showErrorMessageWithHelp('Failed to synchronize code. Target io not found.');
        throw 'target_io_not_found';
    }
    let targetDatastore = resource.datastores.find((v) => v.name == targetIO!.datastore);
    if (!targetDatastore) {
        showErrorMessageWithHelp('Failed to synchronize code. Datastore of the target io not found.');
        throw 'target_datastore_not_found';
    }
    return await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false},
        (async (progress) => {
            progress.report({message: "Synchronizing code...", increment: 0});
            try {
                await azure.account.getSubscriptions(true, activeProfile!.azureConfigDir);
            } catch (err) {
                showErrorMessageWithHelp('Failed to synchronize code. Failed to get subscriptions.');
                throw 'failed_to_get_subscriptions';
            }
            try {
                await azure.storage.upload(
                    workspacePath('../*'),
                    targetIO!.path,
                    targetDatastore!.blobContainer,
                    {
                        recursive: true,
                        excludePath: `.msra_intern_s_toolkit;.git;${cfg.synchronization.ignore_dir}`,
                    },
                    (increment) => progress.report({increment: increment}),
                    activeProfile!.azureConfigDir,
                )
            } catch (err) {
                if (err == 'permission_denied') showErrorMessageWithHelp('Failed to synchronize code. Permission denied.');
                else showErrorMessageWithHelp(`Failed to synchronize code. Code: ${err}`);
                throw 'failed_to_synchronize';
            }
            vscode.window.showInformationMessage('Code synchronized.');
            return 'success';
        })
    );
}

export async function submitToAML(config: JobConfig, progress?: (increment: number) => void) {
    // Divide the io into inputs and outputs
    let inputs: azure.ml.job.Input[] = [];
    let outputs: azure.ml.job.Output[] = [];
    let datastores: azure.ml.Datastore[] = [];
    let io_args: string[] = [];
    for (let io of config.io) {
        let datastore = resource.datastores.find((v) => v.name == io.datastore);
        if (!datastore) {
            showErrorMessageWithHelp(`Failed to submit the job. Datastore ${io.datastore} not found.`);
            throw 'datastore_not_found';
        }
        if (!datastores.includes(datastore)) datastores.push(datastore);
        if ([IOMode.RO_MOUNT, IOMode.DOWNLOAD].includes(io.mode)) {
            inputs.push(new azure.ml.job.Input(io.name, datastore.getUri(io.path), 'uri_folder', io.mode));
            io_args.push(`$\{\{inputs.${io.name}\}\}`);
        }
        else if ([IOMode.RW_MOUNT, IOMode.UPLOAD].includes(io.mode)) {
            outputs.push(new azure.ml.job.Output(io.name, datastore.getUri(io.path), 'uri_folder', io.mode));
            io_args.push(`$\{\{outputs.${io.name}\}\}`);
        }
    }

    // Replace io arguments in the script
    let script = config.experiment.script.join('\n');
    for (let i = 0; i < config.io.length; i++) {
        script = script.replaceAll(`$\{\{${config.io[i].name}\}\}`, `$${i+1}`); // Replace the io arguments with the index
    }
    let command = ['.', './script.sh'].concat(io_args).join(' ');            // Input the io paths into the script

    // Create the temp paths
    let tempDir = `./temp/submit_jobs/${new Date().getTime()}`;
    let scriptPath = `${tempDir}/script.sh`;
    let jobPath = `${tempDir}/job.yaml`;

    // Create the job spec
    let envs: {[key: string]: string} = {};
    if (config.experiment.managed_id) {
        let managedIdentity = resource.managedIdentities.find((v) => v.name == config.experiment.managed_id);
        if (!managedIdentity) {
            showErrorMessageWithHelp(`Failed to submit the job. Managed identity ${config.experiment.managed_id} not found.`);
            throw 'managed_identity_not_found';
        }
        envs['_AZUREML_SINGULARITY_JOB_UAI'] = managedIdentity.id;
    }
    let jobSpec = azure.ml.job.buildSingulaitySpec(
        config.experiment.job_name,
        config.experiment.name,
        workspacePath(scriptPath),
        command,
        envs,
        inputs,
        outputs,
        resource.workspaces
            .find((v) => v.name == config.cluster.workspace)!.images
            .find((v) => v.name == config.environment.image)!,
        resource.virtualClusters.find((v) => v.name == config.cluster.virtual_cluster)!,
        config.cluster.instance_type,
        config.cluster.node_count,
        vscode.workspace.getConfiguration('msra_intern_s_toolkit.submitJobs').get<string>('priority')!,
        config.cluster.sla_tier,
        config.cluster.location,
        vscode.workspace.getConfiguration('msra_intern_s_toolkit.submitJobs').get<object>('interactive')![config.cluster.sla_tier as keyof object],
        vscode.workspace.getConfiguration('msra_intern_s_toolkit.submitJobs').get<boolean>('enableAzmlInt')!,
    );
    
    // Save temp files
    saveWorkspaceFile(scriptPath, script);
    saveWorkspaceFile(jobPath, jobSpec.yaml());

    // Find the workspace
    let workspace = resource.workspaces.find((v) => v.name == config.cluster.workspace);
    if (!workspace) {
        showErrorMessageWithHelp(`Failed to submit the job. Workspace ${config.cluster.workspace} not found.`);
        throw 'failed_to_find_workspace';
    }

    // Create datastores
    let datastoreCreatePromises = await Promise.allSettled(datastores.map((v) => azure.ml.datastore.create(workspace!, v, activeProfile!.azureConfigDir)));
    let errorMsgs = [];
    for (let i = 0; i < datastoreCreatePromises.length; i++) {
        if (datastoreCreatePromises[i].status == 'rejected') {
            if ((datastoreCreatePromises[i] as PromiseRejectedResult).reason == 'azure_ml_ext_not_installed') {
                showErrorMessageWithHelp(`Failed to submit the job. Azure ML extension not installed.`);
                showInstallAzureMLExtension();
                throw 'azure_ml_ext_not_installed';
            }
            errorMsgs.push(`  ${datastores[i].name}`);
        }
    }
    if (errorMsgs.length > 0) {
        showErrorMessageWithHelp(`Failed to submit the job. Failed to create datastores for:\n${errorMsgs.join('\n')}`);
        throw 'failed_to_create_datastores';
    }
    if (progress) { progress(50); }

    // Create the job
    let jobInfo: any;
    try {
        jobInfo = await azure.ml.job.create(workspace, workspacePath(jobPath), activeProfile!.azureConfigDir);
    } catch (err) {
        if (err == 'azure_ml_ext_not_installed') {
            showErrorMessageWithHelp(`Failed to submit the job. Azure ML extension not installed.`);
            showInstallAzureMLExtension();
            throw 'azure_ml_ext_not_installed';
        }
        showErrorMessageWithHelp('Failed to submit the job. Failed to create the job.');
        throw 'failed_to_create_job';
    }
    if (progress) { progress(50); }

    // Show the job info and save the config
    vscode.window.showInformationMessage(`${jobInfo.display_name} submitted.`, 'View in AML Studio').then((choice) => {
        if (choice == 'View in AML Studio') vscode.env.openExternal(vscode.Uri.parse(jobInfo.services.Studio.endpoint));
    });
    saveWorkspaceFile(`./userdata/jobs_history/${jobInfo.display_name}_${new Date().getTime()}.json`, JSON.stringify(config, null, 4));
    return 'success';
}

export async function submit() {
    let cfg: JobConfig = deepCopy(config);
    let argSweep = cfg.experiment.arg_sweep.filter((v) => v.trim() != '').join('\n').trim();
    return await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, cancellable: false}, 
        (async (progress) => {
            progress.report({message: "Submitting the job...", increment: 0});
            
            // Update subscriptions
            try {
                await azure.account.getSubscriptions(true, activeProfile!.azureConfigDir);
            } catch (err) {
                showErrorMessageWithHelp('Failed to synchronize code. Failed to get subscriptions.');
                throw 'failed_to_get_subscriptions';
            }

            // Check virtual cluster, workspace, image, and datastores
            if (resource.virtualClusters.find((v) => v.name == cfg.cluster.virtual_cluster) === undefined) {
                showErrorMessageWithHelp(`Failed to submit the job. Virtual cluster ${cfg.cluster.virtual_cluster} not found.`);
                throw 'failed_to_find_virtual_cluster';
            }
            if (resource.workspaces.find((v) => v.name == cfg.cluster.workspace) === undefined) {
                showErrorMessageWithHelp(`Failed to submit the job. Workspace ${cfg.cluster.workspace} not found.`);
                throw 'failed_to_find_workspace';
            }
            if (resource.workspaces
                    .find((v) => v.name == cfg.cluster.workspace)!.images
                    .find((v) => v.name == cfg.environment.image) === undefined) {
                showErrorMessageWithHelp(`Failed to submit the job. Image ${cfg.environment.image} not found.`);
                throw 'failed_to_find_image';
            }
            for (let io of cfg.io) {
                if (resource.datastores.find((v) => v.name == io.datastore) === undefined) {
                    showErrorMessageWithHelp(`Failed to submit the job. Datastore ${io.datastore} not found.`);
                    throw 'failed_to_find_datastore';
                }
            }

            if (argSweep.length == 0) {
                progress.report({message: "Submitting the job...", increment: 0});
                try {
                    await submitToAML(cfg, (increment) => progress.report({increment: increment}));
                }
                catch (err) {
                    throw 'failed';
                }
                return 'success';
            }
            else {
                let argSweepParsed = ArgSweepParser.parse(argSweep);
                if (argSweepParsed.length == 0) throw 'failed';
                let increment = 100 / (argSweepParsed.length + 1);
                progress.report({message: `(0/${argSweepParsed.length}) Submitting sweep jobs...`, increment: increment});

                for (let i = 0; i < argSweepParsed.length; i++) {
                    let sweep_cfg: JobConfig = deepCopy(cfg);
                    sweep_cfg.experiment.arg_sweep = [];
                    for (let arg of argSweepParsed[i]) {
                        for (let j = 0; j < sweep_cfg.experiment.script.length; j++) {
                            sweep_cfg.experiment.script[j] = sweep_cfg.experiment.script[j].replaceAll(`\${{${arg.name}}}`, arg.value);
                        }
                        sweep_cfg.experiment.job_name = sweep_cfg.experiment.job_name.replaceAll(`\${{${arg.name}}}`, arg.value);
                    }
                 
                    try {await submitToAML(sweep_cfg);}
                    catch (err) {throw 'failed';}

                    progress.report({message: `(${i+1}/${argSweepParsed.length}) Submitting sweep jobs...`, increment: increment});
                }

                saveWorkspaceFile(`./userdata/jobs_history/${cfg.experiment.name}_${new Date().getTime()}_sweep.json`, JSON.stringify(cfg, null, 4));
                return 'success';
            }
        })
    );
}

export function updateConfig(group: string, label: string, value: any) {
    if (group == 'io') {
        config.io = value;
    }
    else {
        (config as any)[group][label] = value;
    }
    saveWorkspaceFile('./userdata/submit_jobs.json', JSON.stringify(config, null, 4));
}

function loadConfig(path: string) {
    if (workspaceExists(path)) {
        config = new JobConfig(JSON.parse(getWorkspaceFile(path)));
    }
}

function saveResourceCache() {
    if (activeProfile === undefined) return;
    let cachePath = `${activeProfile.userDataPath}/resource_cache.json`;
    saveFile(cachePath, JSON.stringify(resource, null, 4));
}

function loadResourceCache() {
    if (activeProfile === undefined) return;
    let cachePath = `${activeProfile.userDataPath}/resource_cache.json`;
    if (exists(cachePath)) {
        resource = new Resource(JSON.parse(getFile(cachePath)));
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

export function refreshComputeResources() {
    getComputeResources().then(() => refreshUI({resource: resource}));
}

export interface uiParams {
    config?: JobConfig;
    resource?: {workspaces: azure.ml.Workspace[], virtualClusters: azure.ml.VirtualCluster[]};
    activeProfile?: profile.Profile | undefined;
}


export function refreshUI(params?: uiParams) {
    console.log(params);
    if (params == undefined) params = {config: config, resource: resource, activeProfile: activeProfile};
    if (ui != undefined) {
        if (!vscode.workspace.workspaceFolders) ui.noWorkspace();
        else ui.setContent(params);
    }
}

export function loggedOut() {
    activeProfile = undefined;
    resource = new Resource();
    refreshUI({resource: resource, activeProfile: activeProfile});
}

export async function loggedIn(profile: profile.Profile) {
    activeProfile = profile;
    loadResourceCache();
    if (resource.workspaces.length == 0 || resource.virtualClusters.length == 0) {
        await getComputeResources();
    }
    refreshUI({resource: resource, activeProfile: activeProfile});
}

export function init() {
    outputChannel.appendLine('[INFO] Initializing job submission module...');
    if (vscode.workspace.workspaceFolders) {
        outputChannel.appendLine('[INFO] Workspace folder found.');
        loadConfig('./userdata/submit_jobs.json');
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
