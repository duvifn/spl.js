import * as pako from 'pako';
import workerStr from './build/js/worker.str.js';
import wasmStr from './build/js/wasm.str.js';
import splVersion from "./build/js/version.js";
import result from './result.js';
import { IDB, IMountOption, ISPL, ISplOptions } from './interfaces.js';

let GLOBAL_ID = 0;
const workerURL= URL.createObjectURL(new Blob([pako.inflate(Uint8Array.from(atob(workerStr), c => c.charCodeAt(0)), { to: 'string' })], { type: 'text/javascript' }));
const wasmBinary = pako.inflate(Uint8Array.from(atob(wasmStr), c => c.charCodeAt(0))).buffer;

const jsToDataUri = (data: string): string => {
    return 'data:text/javascript;base64,' + btoa(data);
}; 

const worker = async (exs=[], options) => {
    options = options || {};
    
    return new Promise<Worker | SharedWorker>((resolve, reject) => {
        exs = exs.reduce((exs, ex) => {
            if (ex.url) {
                return [...exs, ex];
            } else {
                return [...exs, ...Object.keys(ex.fns).map(fn => {
                    const script = `export default ${ex.fns[fn].toString()}`;
                    let exUri: string;
                    if (options.sharedWorker) {
                        // TODO: for very large extension, deflate and inflate in worker side
                        exUri = jsToDataUri(script);
                    } else {
                        exUri = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
                    }
                    const ex_ = {
                        extends: ex.extends,
                        url: exUri,
                        fns: {}
                    };
                    ex_.fns[fn] = 'default';
                    return ex_;
                })];
            }
        }, []);

        const workerConstructor = options.sharedWorker ? SharedWorker : Worker;
        const workerName = options.sharedWorkerName;
        let workerScriptUrl: string;
        if (options.workerURL) {
            workerScriptUrl = options.workerURL;
        } else if (options.sharedWorker) {
            workerScriptUrl = jsToDataUri(pako.inflate(Uint8Array.from(atob(workerStr), c => c.charCodeAt(0)), { to: 'string' }));
        } else {
            workerScriptUrl = workerURL;
        }
        
        const worker = new workerConstructor(workerScriptUrl,  {name: workerName});
        const port: MessagePort | Worker = options.sharedWorker ? (worker as SharedWorker).port : worker as Worker;
        port.onmessage = () => {
            resolve(worker);
        };
        worker.onerror = (err) => {
            reject(err.message)
        };
        port.postMessage({ wasmBinary, exs, options, splVersion });
    });
};


const spl = function (wkr: Worker | SharedWorker, exs=[]): ISPL {

    // @ts-ignore
    if (!new.target) return new spl(wkr, exs);

    const queue: {[index: number]: { resolve: Function, reject: Function }} = {};
    const stackSpl = [];
    const port: MessagePort | Worker = wkr instanceof SharedWorker ? wkr.port : wkr;
    port.onmessage = (evt) => {
        const { __id__, res, err } = evt.data;
        err ? queue[__id__].reject(err) : queue[__id__].resolve(res);
        delete queue[__id__];
    };

    wkr.onerror = (evt) => {
        evt.preventDefault();
        console.log(evt.message);
    };


    const post = (msg, resolve?: Function, reject?: Function): Promise<any> => {
        return new Promise((_resolve, _reject) => {
            msg.__id__ = ++GLOBAL_ID;
            msg.splVersion = splVersion;
            queue[msg.__id__] = {
                resolve: res => {
                    (resolve || _resolve)(res);
                },
                reject: err => {
                    (reject || _reject)(err);
                }
            };
            port.postMessage(msg);
        });
    };

    const thenSpl = () => {
        if (this.then === this) {
            this.then = (resolve: Function, reject: Function) => {
                if (stackSpl.length) {
                    return post({
                        fn: stackSpl.splice(0)
                    }, res => {
                        if (res !== null && typeof(res) === 'object' && res.this === 'spl') {
                            this.then = this;
                            resolve(this);
                        } else {
                            resolve(res);
                        }
                    }, reject);
                } else {
                    this.then = this;
                    resolve(this);
                }
            }
        }
        return this;
    }

    this.db = function(sqlite3?: string | ArrayBuffer): IDB {

        // @ts-ignore
        if (!new.target) return new this.db(sqlite3);

        const _db = this;
        const id = Math.round(Number.MAX_SAFE_INTEGER * Math.random());
        const stackDB = [...stackSpl.splice(0), {
            fn: 'db',
            id,
            args: [sqlite3 || ':memory:']
        }];
        const get = (fn) => post({
            fn: [
                ...stackDB.splice(0),
                { id, fn }
            ]
        });
        const thenDB = () => {
            if (this.then === this) {
                this.then = (resolve: Function, reject: Function) => {
                    if (stackDB.length) {
                        const jobs = [stackDB.shift()];
                        const firstIsRunAlone = jobs[0].runAlone;
                        while (stackDB.length && 
                              !stackDB[0].runAlone && 
                              !firstIsRunAlone) {
                            jobs.push(stackDB.shift());
                        }
                        return post({
                            fn: jobs
                        }, res => {
                            if (typeof(res) === 'object' && res.this === 'db') {
                                this.then = this;
                                resolve(this);
                            // } else if (res.__res && Number.isFinite(res.__res)) {
                            //     resolve(result(res.__res));
                            } else {
                                resolve(res);
                            }
                        }, reject).finally(() => {
                            if (stackDB.length && this.then) {
                                return this.then(resolve, reject);
                            }
                        });
                    } else {
                        this.then = this;
                        resolve(this);
                    }
                }
            }
            return this;
        }

        this.then = this

        this.attach = (db: string, schema: string) => {

            stackDB.push({
                id,
                fn: 'db.attach',
                args: [db, schema]
            });

            return thenDB();

        }

        this.detach = (schema: string) => {

            stackDB.push({
                id,
                fn: 'db.detach',
                args: [schema]
            });

            return thenDB();

        }

        this.exec = (sql: string, par) => {
            stackDB.push({
                id,
                fn: 'db.exec',
                args: [sql, par]
            });

            return thenDB();
        };

        this.read = (sql: string) => {
            stackDB.push({
                id,
                fn: 'db.read',
                args: [sql]
            });
            return thenDB();
        };


        this.load = (src: string) => {
            stackDB.push({
                id,
                fn: 'db.load',
                args: [src]
            });
            return thenDB();
        };

        this.save = () => {
            stackDB.push({
                id,
                fn: 'db.save',
                args: []
            });
            return thenDB();
        };

        this.close = () => {
            stackSpl.push(
                ...stackDB.splice(0),
                {
                    id,
                    fn: 'db.close'
                }
            );
            return thenSpl();
        };

        this.get = {
            get first()  {
                return get('res.first');
            },
            get flat()  {
                return get('res.flat');
            },
            get rows()  {
                return get('res.rows');
            },
            get cols()  {
                return get('res.cols');
            },
            get objs()  {
                return get('res.objs');
            },
            get sync()  {
                return get('res.sync')
                    .then(res => result(...res));
            },
            free()  {
                return get('res.free');
            }
        };

        exs.filter(ex => ex.extends === 'db').forEach(ex => {
            Object.keys(ex.fns).forEach(fn_ => {
                if (!(fn_ in this)) {
                    const fn = `db.${fn_}`;
                    this[fn_]  = (...args) => (fn => {
                        stackDB.push({
                            runAlone: ex.runAlone,
                            id,
                            fn,
                            args
                        });
                        return thenDB();
                    })(fn);
                }
            })
        })

        return thenDB();

    }

    this.then = this;

    this.version = () => {
        stackSpl.push({
            fn: 'version',
            args: []
        });
        return thenSpl();
    };

    this.mount = (path: string, options: IMountOption[]) => {
        stackSpl.push({
            fn: 'mount',
            args: [path, path, options]
        });
        return thenSpl();
    };

    this.unmount = (path: string) => {
        stackSpl.push({
            fn: 'unmount',
            args: [path]
        });
        return thenSpl();
    };

    this.terminate = (closeShared: boolean = false) => {
        if (wkr instanceof Worker) {
            wkr.terminate();
        } else if (closeShared) {
            const msg = {
                fn: 'close',
                args: [],
                __id__: ++GLOBAL_ID
            };
            // Post immediately (don't chain it to previous ones)
            post(msg, (res) => {}, (err) => {});
            wkr.onerror = undefined;
            port.onmessage = undefined;
            const properties = Object.getOwnPropertyNames(queue);
            for (const prop of properties) {
                queue[prop].reject("Shared worker was closed.");
            }
            return;
        } else {
            const msg = {
                fn: 'unregister',
                args: [],
                __id__: ++GLOBAL_ID
            };
            // Post immediately (don't chain it to previous ones)
            post(msg, (res) => {}, (err) => {});
            wkr.onerror = undefined;
            port.onmessage = undefined;
            const properties = Object.getOwnPropertyNames(queue);
            for (const prop of properties) {
                queue[prop].reject("Shared worker was closed.");
            }
            return;
        }
    }

    exs.filter(ex => ex.extends === 'spl').forEach(ex => {
        Object.keys(ex.fns).forEach(fn => {
            if (!(fn in this)) {
                this[fn]  = (...args) => (fn => {
                    stackSpl.push({
                        fn,
                        args
                    });
                    return thenSpl();
                })(fn);
            }
        })
    })

};

export default (exs=[], options: ISplOptions): Promise<ISPL> => worker(exs, options).then(wrk => spl(wrk, exs));
