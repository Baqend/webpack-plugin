const db = require('baqend');
const anymatch = require('anymatch');
const fs = require('fs');
const chalk = require('chalk');

function padLeft(str, len) {
    const pad = ' '.repeat(len);
    const origLen = str.length;
    return pad.substring(0, len - origLen) + str;
}

class BaqendWebpackPlugin {

    /**
     * @param {string} app The Baqend app to deploy to.
     * @param {string} bucket The remote path on Baqend to deploy files to, "www" by default.
     * @param {string} filePattern The file directory to deploy files from.
     */
    constructor({ app, bucket, filePattern }) {
        this.app = app;
        this.bucket = bucket || 'www';
        this.filePattern = filePattern;

        // Connect to Baqend
        db.connect(app).catch((err) => console.error(err));
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
    async executeDeployment({ compilation, hash }) {
        const [ prefix ] = (this.filePattern && this.filePattern.match(/^([^*{}]*)\//)) || [''];
        const filesToUpload = Object.entries(compilation.assets);

        // Ensure we're connected to Baqend
        await db.ready();

        console.log(chalk`{rgb(242,115,84) [Baqend]} Uploading {bold ${hash}} to Baqend app {bold ${this.app}}...`);

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
        const stat = fs.statSync(existsAt);
        const file = new db.File({path, data: fs.createReadStream(existsAt), size: stat.size, type: 'stream'});

        await file.upload({ force: true });
    }
}

module.exports = BaqendWebpackPlugin;
