import * as vscode from 'vscode';
import { vscodeContext } from '../extension';
import { getExtensionFile } from '../helper/file_utils';
import * as pim from '../pim';

export class PIMView implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private html: string;

    constructor() {
        this.html = getExtensionFile('html/pim.html');
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        this.view = webviewView;
        let codiconsUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(vscodeContext.extensionUri, 'html', 'codicons', 'codicon.css'));
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.html
            .replace('${{codicon_css_uri}}', codiconsUri.toString());
        webviewView.webview.onDidReceiveMessage((message: any) => {
            // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Receive ' + JSON.stringify(message));
            switch (message.command) {
                case 'getContent':
                    pim.refreshUI();
                    break;
                case 'activate':
                    pim.activate(message.name);
                    break;
                case 'deactivate':
                    pim.deactivate(message.name);
                    break;
                case 'enableAutoActivation':
                    pim.enableAutoActivation(message.name);
                    break;
                case 'disableAutoActivation':
                    pim.disableAutoActivation(message.name);
                    break;
            }
        });
        // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Webview resolved');
    }

    public setContent(params: pim.uiParams) {
        if (this.view) {
            let message = {command: 'setContent', params: params};
            this.view.webview.postMessage(message);
            this.view.title = 'Privileged Identity Management' + (params.activeProfile ? ` (${params.activeProfile.name})` : '');
        }
    }

    public update(name: string, state: string) {
        if (this.view) {
            let message = {command: 'update', params: {name: name, state: state}};
            this.view.webview.postMessage(message);
        }
    }
}