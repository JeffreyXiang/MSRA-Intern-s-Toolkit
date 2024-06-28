import * as vscode from 'vscode';

export function deepCopy(obj: any): any {
    var copy;

    // Handle the 3 simple types, and null or undefined
    if (null == obj || typeof obj != "object") return obj;

    // Handle Array
    if (obj instanceof Array) {
        copy = [];
        for (var i = 0, len = obj.length; i < len; i++) {
            copy[i] = deepCopy(obj[i]);
        }
        return copy;
    }

    // Handle Object
    if (obj instanceof Object) {
        copy = {} as any; // Add an index signature to allow indexing with a string
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = deepCopy(obj[attr]);
        }
        return copy;
    }

    throw new Error("Unable to copy obj! Its type isn't supported.");
}

export function mapToObj(map: Map<any, any>): any {
    let obj: any = {};
    map.forEach((value, key) => {
        obj[key] = value;
    });
    return obj;
}

export function objToMap(obj: any): Map<any, any> {
    let map = new Map();
    Object.keys(obj).forEach(key => {
        map.set(key, obj[key]);
    });
    return map;
}

export function showErrorMessageWithHelp(text: string){
    vscode.window.showErrorMessage(text, 'Helps' ,'OK').then((choice) => {
        if (choice == 'Helps'){
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/JeffreyXiang/MSRA-Intern-s-Toolkit#troubleshooting'))
        }
    })
}

export function randomString(length: number, withUpperCase: boolean = false): string {
    let chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    if (withUpperCase) {
        chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    }
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export const uuid4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        // tslint:disable-next-line:no-bitwise
        const r = (Math.random() * 16) | 0;
        // tslint:disable-next-line:no-bitwise
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

