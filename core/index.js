const webpack = require('./webpack')
// const webpack = require('webpack')
const config = require('../example/webpack.config')

// 步骤1，初始化参数 根据配置文件和 shell 参数合成参数
// webpack() 方法会返回一个 compiler 对象

// 步骤2，调用 webpack(options) 初始化 compiler 对象
const compiler = webpack(config)

// 调用 run 方法进行打包
compiler.run((err, stats) => {
    if (err) {
        console.log(err, 'err')
        return
    }
    // ...
})


