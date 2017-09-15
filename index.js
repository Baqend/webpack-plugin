const db = require('baqend');
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
     */
    constructor({ app, bucket }) {
        this.app = app;
        this.bucket = bucket || 'www';

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
        const filesToUpload = Object.entries(compilation.assets);

        // Ensure we're connected to Baqend
        await db.ready();

        console.log(chalk`{rgb(242,115,84) [Baqend]} Uploading {bold ${hash}} to Baqend app {bold ${this.app}}...`);

        const firstColWidth = filesToUpload.reduce((last, [assetName]) => Math.max(last, assetName.length), 5);
        console.log(chalk`{bold ${padLeft('Asset', firstColWidth)}}              {bold Bucket Path}`);

        // Upload each file asynchronously
        await Promise.all(filesToUpload.map(async ([assetName, asset]) => {
            const { existsAt } = asset;
            const path = `/${this.bucket}/${assetName}`;
            await this.uploadFile(path, existsAt);

            console.log(chalk`{bold.green ${padLeft(assetName, firstColWidth)}}  {bold.green [uploaded]}  ${path}`);
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
