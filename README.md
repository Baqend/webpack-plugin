Baqend Webpack Plugin
=====================
> Webpack plugin for the Baqend Cloud

## Installation

Install via NPM:
    
    npm install --save-dev baqend-webpack-plugin
    
Add to your `webpack.config.js`:

    const BaqendWebpackPlugin = require('baqend-webpack-plugin');
    
    module.exports = {
        // ...
        
        plugins: [
            // ...
            
            new BaqendWebpackPlugin({ app: 'your-baqend-app' }), 
        ]
    };


## Configuration

You can configure the plugin within the constructor with the following options. 

* **app** *(required, string)* : Allows you to specify to which app on Baqend you want to deploy your assets.
* **bucket** *(optional, string or false, defaults to `"www"`)* : Select the file bucket on Baqend to deploy your assets to. If you pass `false`, no files will be deployed.
* **filePattern** *(optional, string)* : Specify a glob pattern to filter the assets which should be deployed.
* **codeDir** *(optional, string or false, defaults to `false`)* : Choose a directory to deploy Baqend code from. If you pass `false`, no code will be deployed.
