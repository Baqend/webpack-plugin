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
        })
    })
}

function readStat(filePath) {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stat) => {
            err ? reject(err) : resolve(stat);
        })
    });
}

function readFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf-8', (err, file) => {
            err ? reject(err) : resolve(file);
        })
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

        // Connect to Baqend
        this.isConnected = require('baqend/cli/account').login({ app: this.app }).then((db) => this.db = db);
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
    async executeDeployment({ compilation: { assets }, hash }) {
        const filesToUpload = Object.entries(assets);

        // Ensure we're connected to Baqend
        await this.isConnected;

        console.log(chalk`{rgb(242,115,84) [Baqend]} Uploading {bold ${hash}} to Baqend app {bold ${this.app}}...`);

        if (this.codeDir !== false) {
            await this.uploadCodeDir();
        }
        if (this.bucket !== false) {
            await this.uploadFiles(filesToUpload);
        }
    }

    async uploadCodeDir() {
        try {
            const files = await readDirectory(this.codeDir);

            return Promise.all(files.map(async (fileName) => {
                const stat = await readStat(path.join(this.codeDir, fileName));
                if (stat.isDirectory()) {
                    try {
                        await this.uploadHandler(fileName, this.codeDir);
                    } catch (e) {
                        console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload handlers for {bold ${fileName}}: {red ${e.reason}}`);
                    }
                    return;
                }

                const moduleName = fileName.replace(/\.js$/, '');
                try {
                    await this.uploadCode(moduleName);
                    console.log(chalk`{rgb(242,115,84) [Baqend]} Uploaded module {bold ${moduleName}}`);
                } catch (e) {
                    console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload module {bold ${moduleName}}: {red ${e.reason}}`);
                }
            }));
        } catch (e) {
            console.log(chalk`{rgb(242,115,84) [Baqend]} {red Failed} to upload Baqend code: {red Directory ${this.codeDir} does not exist}`);
        }
    }

    /**
     * Uploads a handler directory.
     *
     * @param bucket The bucket to upload the handlers of
     */
    async uploadHandler(bucket) {
        if (!this.db[bucket]) {
            return;
        }

        const fileNames = await readDirectory(path.join(this.codeDir, bucket));
        return Promise.all(fileNames.map(async (fileName) => {
            const handlerType = fileName.replace(/.js$/, '');
            await this.uploadCode(bucket, handlerType);
            console.log(chalk`{rgb(242,115,84) [Baqend]} Uploaded {bold ${handlerType}} handler for {bold ${bucket}}`);
        }));
    }

    /**
     * Uploads a Baqend code.
     *
     * @param bucket The bucket's name
     * @param type The type of code which is uploaded
     */
    async uploadCode(bucket, type = 'module') {
        const filename = type == 'module' ? path.join(this.codeDir, bucket + '.js') : path.join(this.codeDir, bucket, type + '.js');
        const file = await readFile(filename);
        if (!codeTypes.includes(type)) {
            return;
        }

        return this.db.code.saveCode(bucket, type, file);
    }

    async uploadFiles(filesToUpload) {
        // Get the directory prefix
        const [ prefix ] = (this.filePattern && this.filePattern.match(/^([^*{}]*)\//)) || [''];

        // Display uploaded files
        const firstColWidth = filesToUpload.reduce((last, [assetName]) => Math.max(last, assetName.length), 5);
        const bucketColWidth = Math.max(this.bucket.length, 6);
        console.log(chalk`{bold ${padLeft('Asset', firstColWidth)}}  {bold ${padLeft('Bucket', bucketColWidth)}}              {bold Path}`);

        // Upload each file asynchronously
        await Promise.all(filesToUpload.map(async ([assetName, asset]) => {
            if (this.filePattern && !anymatch(this.filePattern, assetName)) {
                console.log(chalk`{bold.yellow ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.yellow [skipped]}`);
                return;
            }

            try {
                const { existsAt } = asset;
                const path = `/${this.bucket}/${assetName.replace(prefix, '')}`;
                await this.uploadFile(path, existsAt);

                console.log(chalk`{bold.green ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.green [uploaded]}  ${path}`);
            } catch (e) {
                console.log(chalk`{bold.red ${padLeft(assetName, firstColWidth)}}  ${padLeft(this.bucket, bucketColWidth)}  {bold.red [failed]}`);
            }
        }));
    }

    /**
     * Uploads a file to Baqend.
     *
     * @param path The remote path of the file
     * @param existsAt The local full pathname of the file
     */
    async uploadFile(path, existsAt) {
        const stat = await readStat(existsAt);
        const file = new this.db.File({path, data: fs.createReadStream(existsAt), size: stat.size, type: 'stream'});

        await file.upload({ force: true });
    }
}

module.exports = BaqendWebpackPlugin;
