import * as vscode from 'vscode';
import { getFile } from '../helper/file_utils';
import * as job from '../submit_jobs';
import { vscodeContext } from '../extension';
import { deepCopy } from '../utils';

const Display2IOMode = new Map<string, job.IOMode>([
    ['Read Only Mount', job.IOMode.RO_MOUNT],
    ['Read Write Mount', job.IOMode.RW_MOUNT],
    ['Download', job.IOMode.DOWNLOAD],
    ['Upload', job.IOMode.UPLOAD],
]);

const IOMode2Display = new Map<job.IOMode, string>([
    [job.IOMode.RO_MOUNT, 'Read Only Mount'],
    [job.IOMode.RW_MOUNT, 'Read Write Mount'],
    [job.IOMode.DOWNLOAD, 'Download'],
    [job.IOMode.UPLOAD, 'Upload'],
]);

export class SubmitJobsView implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private html: string;

    constructor() {
        this.html = getFile('html/submit_jobs.html');
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        this.view = webviewView;
        let codiconsUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(vscodeContext.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.html
            .replace('${{codicon_css_uri}}', codiconsUri.toString());
        webviewView.webview.onDidReceiveMessage((message: any) => {
            switch (message.command) {
                case 'getContent':
                    job.refreshUI();
                    break;
                case 'update':
                    if (message.params.group == 'experiment' && message.params.label == 'script' ||
                        message.params.group == 'experiment' && message.params.label == 'arg_sweep') {
                        message.params.value = message.params.value.split('\n');
                    }
                    if (message.params.group == 'io') {
                        message.params.value = message.params.value.map((v: any) => {
                            let io = new job.IOConfig();
                            io.name = v.name;
                            io.datastore = v.datastore;
                            io.path = v.path;
                            io.mode = Display2IOMode.get(v.mode)!;
                            return io;
                        });
                    }
                    job.updateConfig(message.params.group, message.params.label, message.params.value);
                    break;
                case 'refreshComputeResources':
                    job.refreshComputeResources();
                    break;
                case 'manageDatastores':
                    job.manageDatastores();
                    break;
                case 'load':
                    job.load();
                    break;
                case 'save':
                    job.save();
                    break;
                case 'synchronize':
                    job.synchronize();
                    break;
                case 'submit':
                    job.submit();
                    break;
            }
        });
    }

    public setContent(params: job.uiParams) {
        if (this.view) {
            let msg_params = deepCopy(params);
            if (params.config) {
                msg_params.config.experiment.script = params.config.experiment.script.join('\n');
                msg_params.config.experiment.arg_sweep = msg_params.config.experiment.arg_sweep.join('\n');
                for (let i = 0; i < msg_params.config.io.length; i++) {
                    msg_params.config.io[i].mode = IOMode2Display.get(msg_params.config.io[i].mode)!;
                }
            }
            let message = {command: 'setContent', params: msg_params};
            this.view.webview.postMessage(message);
        }
    }

    public noWorkspace() {
        if (this.view) {
            let message = {command: 'noWorkspace'};
            this.view.webview.postMessage(message);
        }
    }
}