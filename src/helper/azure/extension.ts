import * as cp from 'child_process'
import {outputChannel} from '../../extension'
import {parseJson} from './utils'

export async function add(name: string, version?: string, upgrade?: boolean, configDir?: string): Promise<void> {
    let command = 'az extension add --name ' + name;
    if (version) {
        command += ' --version ' + version;
    }
    if (upgrade) {
        command += ' --upgrade';
    }
    outputChannel.appendLine('[CMD] > ' + command);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(command, {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                reject('failed_to_install_azure_ml_ext');
            }
            else {
                resolve();
            }
        });
    });
}

export async function list(configDir?: string): Promise<any> {
    outputChannel.appendLine('[CMD] > az extension list');
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec('az extension list', {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                reject('failed_to_list_azure_ml_ext');
            }
            if (stdout) {
                outputChannel.appendLine('[CMD OUT] ' + stdout);
                try {
                    resolve(parseJson(stdout));
                }
                catch (e) {
                    reject(e);
                }
            }
            if (stderr) {
                outputChannel.appendLine('[CMD ERR] ' + stderr);
                reject('failed_to_list_azure_ml_ext');
            }
        });
    });
}

export async function remove(name: string, configDir?: string): Promise<void> {
    let command = 'az extension remove --name ' + name;
    outputChannel.appendLine('[CMD] > ' + command);
    let env = process.env;
    if (configDir) {
        env['AZURE_CONFIG_DIR'] = configDir;
    }
    return new Promise((resolve, reject) => {
        cp.exec(command, {env: env}, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine('[CMD ERR] ' + error.message);
                reject('failed_to_uninstall_azure_ml_ext');
            }
            else {
                resolve();
            }
        });
    });
}
