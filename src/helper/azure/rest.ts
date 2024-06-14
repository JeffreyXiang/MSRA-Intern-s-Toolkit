import * as cp from 'child_process'
import {outputChannel} from '../../extension'

export enum RESTMethod {
    DELETE = 'delete',
    GET = 'get',
    HEAD = 'head',
    OPTIONS = 'options',
    PATCH = 'patch',
    POST = 'post',
    PUT = 'put',
}

export async function request(method: RESTMethod, uri: string, body?: any, headers?: {[key: string]: string}) {
    let bodyStr = body ? JSON.stringify(body) : undefined;
    let headersStr = headers ? JSON.stringify(headers) : undefined;
    if (!uri.startsWith('\"') && !uri.endsWith('\"')) uri = `"${uri}"`;
    let args = ['rest',
        '--method', method,
        '--uri', uri,
    ];
    if (bodyStr) args.push('--body', `"${bodyStr.replaceAll(`'`, `\\'`).replaceAll(`"`, `'`)}"`);
    if (headersStr) args.push('--headers', `"${headersStr.replaceAll(`'`, `\\'`).replaceAll(`"`, `'`)}"`);
    outputChannel.appendLine('[CMD] > az ' + args.join(' '));
    return new Promise<any>((resolve, reject) => {
        cp.exec('az ' + args.join(' '), {}, (error, stdout, stderr) => {
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                resolve(JSON.parse(stdout));
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                reject(stderr);
            }
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                reject(error.message);
            }
        });
    });
}

export async function batchRequest(requests: {httpMethod: RESTMethod, relativeUrl: string, content?: any}[]) {
    let responses = await request(
        RESTMethod.POST,
        '/batch?api-version=2020-06-01',
        {requests: requests}
    );
    return responses.responses;
}
