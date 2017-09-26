const anymatch = require('anymatch');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const codeTypes = ['module', 'update', 'insert', 'delete', 'validate'];

function padLeft(str, len) {
    const pad = ' '.repeat(len);
    const origLen = str.length;
    return pad.substring(0, len - origLen) + str;
}

function readDirectory(filePath) {
    return new Promise((resolve, reject) => {
        fs.readdir(filePath, (err, fileNames) => {
            err ? reject(err) : resolve(fileNames);
        });
    });
}

function readStat(filePath) {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stat) => {
            err ? reject(err) : resolve(stat);
        });
    });
}

function readFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf-8', (err, file) => {
            err ? reject(err) : resolve(file);
        });
    });
}

class BaqendWebpackPlugin {

    /**
     * @param {string} app The Baqend app to deploy to.
     * @param {string} bucket The remote path on Baqend to deploy files to, "www" by default.
     * @param {string} filePattern The file directory to deploy files from.
     * @param {string} codeDir The directory containing Baqend Code to deploy.
     */
    constructor({ app, bucket, filePattern, codeDir }) {
        this.app = app;
        this.bucket = bucket === false ? bucket : (bucket || 'www');
        this.filePattern = filePattern;
        this.codeDir = codeDir || false;
    }

    /**
     * Applies the plugin for Webpack.
     *
     * @param compiler Webpack's compiler instance
     */
    apply(compiler) {
        // Specifies webpack's event hook to attach itself.
        compiler.plugin('done', (compilation) => {
            this.executeDeployment(compilation);
        });
    }

    /**
     * Executes the deployment to Baqend.
     *
     * @param compilation The Webpack compilation result
     * @param hash The Webpack compilation hash.
     */
    executeDeployment({ compilation: { assets }, hash }) {
        // Ensure we're connected to Baqend
        let promise;
        if (this.db) {
            promise = this.db.ready();
        } else {
            promise = require('baqend/cli/account').login({ app: this.app }).then(db => this.db = db);
        }

        return promise.then(() => {
            console.log(chalk`{rgb(242,115,84) [Baqend]} Uploading {bold ${hash}} to Baqend app {bold ${this.app}}...`);

            if (this.codeDir !== false) {
                return this.uploadCodeDir();
            }
        }).then(() => {
            if (this.bucket !== false) {
                return this.uploadFiles(assets);
            }
        });
    }

    uploadCodeDir() {
        return readDirectory(this.codeDir).then((files) => {
            return Promise.all(files.map((fileName) => {
                return readStat(path.join(this.codeDir, fileName)).then((stat) => {
                    if (stat.isDirectory()) {
                        return this.uploadHandler(fileName, this.codeDir).catch((e) => {
                            console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload handlers for {bold ${fileName}}: {red ${e.reason}}`);
                        });
                    }

                    const moduleName = fileName.replace(/\.js$/, '');
                    return this.uploadCode(moduleName).then(() => {
                        console.log(chalk`{rgb(242,115,84) [Baqend]} Uploaded module {bold ${moduleName}}`);
                    }).catch((e) => {
                        console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload module {bold ${moduleName}}: {red ${e.reason}}`);
                    });
                });
            }));
        }).catch(() => {
            console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload Baqend code: {red Directory ${this.codeDir} does not exist}`);
        });
    }

    /**
     * Uploads a handler directory.
     *
     * @param bucket The bucket to upload the handlers of
     */
    uploadHandler(bucket) {
        if (!this.db[bucket]) {
            return Promise.resolve();
        }

        return readDirectory(path.join(this.codeDir, bucket)).then((fileNames) => {
            return Promise.all(fileNames.map((fileName) => {
                const handlerType = fileName.replace(/.js$/, '');
                return this.uploadCode(bucket, handlerType).then(() => {
                    console.log(chalk`{rgb(242,115,84) [Baqend]} Uploaded {bold ${handlerType}} handler for {bold ${bucket}}`);
                });
            }));
        });
    }

    /**
     * Uploads a Baqend code.
     *
     * @param bucket The bucket's name
     * @param type The type of code which is uploaded
     */
    uploadCode(bucket, type = 'module') {
        const filename = type == 'module' ? path.join(this.codeDir, bucket + '.js') : path.join(this.codeDir, bucket, type + '.js');
        return readFile(filename).then((file) => {
            if (!codeTypes.includes(type)) {
                return;
            }

            return this.db.code.saveCode(bucket, type, file);
        });
    }

    uploadFiles(assets) {
        // Get the directory prefix
        const [prefix] = (this.filePattern && this.filePattern.match(/^([^*{}]*)\//)) || [''];

        // Display uploaded files
        const assetNames = Object.keys(assets);
        const firstColWidth = assetNames.reduce((last, assetName) => Math.max(last, assetName.length), 5);
        const bucketColWidth = Math.max(this.bucket.length, 6);
        console.log(chalk`{bold ${padLeft('Asset', firstColWidth)}}  {bold ${padLeft('Bucket', bucketColWidth)}}              {bold Path}`);

        // Upload each file asynchronously
        return Promise.all(assetNames.map(name => ([name, assets[name]])).map(([assetName, asset]) => {
            if (this.filePattern && !anymatch(this.filePattern, assetName)) {
                console.log(chalk`{bold.yellow ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.yellow [skipped]}`);
                return;
            }

            const { existsAt } = asset;
            const path = `/${this.bucket}/${assetName.replace(prefix, '')}`;
            return this.uploadFile(path, existsAt).then(() => {
                console.log(chalk`{bold.green ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.green [uploaded]}  ${path}`);
            }).catch((e) => {
                console.log(chalk`{bold.red ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.red [failed]}    {red Error: ${e.reason}}`);
            });
        }));
    }

    /**
     * Uploads a file to Baqend.
     *
     * @param path The remote path of the file
     * @param existsAt The local full pathname of the file
     */
    uploadFile(path, existsAt) {
        return readStat(existsAt).then((stat) => {
            const file = new this.db.File({ path, data: fs.createReadStream(existsAt), size: stat.size, type: 'stream' });

            return file.upload({ force: true });
        });
    }
}

module.exports = BaqendWebpackPlugin;
