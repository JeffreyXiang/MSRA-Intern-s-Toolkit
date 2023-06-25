import * as vscode from 'vscode';
import { getFile } from '../utils';
import * as job from '../submit_jobs';
import { stat } from 'fs';

export class SubmitJobsView implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private html: string;

    constructor() {
        this.html = getFile('html/submit_jobs.html');
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.html;
        webviewView.webview.onDidReceiveMessage((message: any) => {
            // console.log('msra_intern_s_toolkit.ui.SubmitJobsView: Receive ' + JSON.stringify(message));
            switch (message.command) {
                case 'getContent':
                    job.refreshUI();
                    break;
                case 'update':
                    if (message.params.group == 'environment' && message.params.label == 'setup_script' ||
                        message.params.group == 'experiment' && message.params.label == 'script') {
                        message.params.value = message.params.value.split('\n');
                    }
                    job.updateConfig(message.params.group, message.params.label, message.params.value);
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
                    job.synchronize().then((status) => {
                        if (status == 'success' || status == 'skipped') job.submit();
                    });
                    break;
            }
        });
        // console.log('msra_intern_s_toolkit.ui.SubmitJobsView: Webview resolved');
    }

    public setContent(config: job.JobConfig) {
        if (this.view) {
            if (typeof config.environment.setup_script !== 'string') {
                config.environment.setup_script = config.environment.setup_script.join('\n');
            }
            if (typeof config.experiment.script !== 'string') {
                config.experiment.script = config.experiment.script.join('\n');
            }
            let message = {command: 'setContent', params: config};
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