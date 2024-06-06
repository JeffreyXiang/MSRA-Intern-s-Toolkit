import * as vscode from 'vscode';
import { getFile } from '../helper/file_utils';
import * as job from '../submit_jobs';
import { vscodeContext } from '../extension';

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
            // console.log('msra_intern_s_toolkit.ui.SubmitJobsView: Receive ' + JSON.stringify(message));
            switch (message.command) {
                case 'getContent':
                    job.refreshUI();
                    break;
                case 'update':
                    if (message.params.group == 'experiment' && message.params.label == 'script' ||
                        message.params.group == 'experiment' && message.params.label == 'arg_sweep') {
                        message.params.value = message.params.value.split('\n');
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
        // console.log('msra_intern_s_toolkit.ui.SubmitJobsView: Webview resolved');
    }

    public setContent(params: job.uiParams) {
        let msg_params = JSON.parse(JSON.stringify(params));
        if (this.view) {
            if (msg_params.hasOwnProperty('config')) {
                if (typeof msg_params.config.experiment.script !== 'string') {
                    msg_params.config.experiment.script = msg_params.config.experiment.script.join('\n');
                }
                if (typeof msg_params.config.experiment.arg_sweep !== 'string') {
                    msg_params.config.experiment.arg_sweep = msg_params.config.experiment.arg_sweep.join('\n');
                }
            }
            let message = {command: 'setContent', params: msg_params};
            this.view.webview.postMessage(message);
            // console.log('msra_intern_s_toolkit.ui.SubmitJobsView: Send ' + JSON.stringify(message));
        }
    }

    public noWorkspace() {
        if (this.view) {
            let message = {command: 'noWorkspace'};
            this.view.webview.postMessage(message);
        }
    }
}