import * as vscode from 'vscode';
import { getFile } from '../helper/file_utils';
import * as gcr from '../gcr_tunnel';

export class GCRTunnelView implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private html: string;

    constructor() {
        this.html = getFile('html/gcr_tunnel.html');
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.html;
        webviewView.webview.onDidReceiveMessage((message: any) => {
            // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Receive ' + JSON.stringify(message));
            switch (message.command) {
                case 'getContent':
                    gcr.refreshUI();
                    break;
                case 'add':
                    gcr.addTunnel();
                    break;
                case 'delete':
                    gcr.deleteTunnel();
                    break;
                case 'open':
                    gcr.openTunnel(message.idx);
                    break;
                case 'close':
                    gcr.closeTunnel(message.idx);
                    break;
            }
        });
        // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Webview resolved');
    }

    public setContent(tunnels: gcr.Tunnel[]) {
        if (this.view) {
            let message = {command: 'setContent', params: tunnels};
            this.view.webview.postMessage(message);
            // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Send ' + JSON.stringify(message));
        }
    }

    public unsupported() {
        if (this.view) {
            let message = {command: 'unsupported'};
            this.view.webview.postMessage(message);
        }
    }

    public update(idx: number, tunnel: gcr.Tunnel) {
        if (this.view) {
            let message = {command: 'update', params: {idx: idx, tunnel: tunnel}};
            this.view.webview.postMessage(message);
            // console.log('msra_intern_s_toolkit.ui.GCRTunnelView: Send ' + JSON.stringify(message));
        }
    }
}