'use strict';

const updateNotifier = require('update-notifier');
const webpack = require('webpack');
const weblog = require('webpack-log');
const eventbus = require('./lib/bus');
const { timeFix, toArray, wrap } = require('./lib/config');
const getOptions = require('./lib/options');
const getServer = require('./lib/server');
const pkg = require('./package.json');

module.exports = (opts) => {
  updateNotifier({ pkg }).notify();

  return getOptions(opts)
    .then((results) => {
      const { options, configs } = results;
      const log = weblog({ name: 'serve', id: 'webpack-serve' });

      options.bus = eventbus(options);
      const { bus } = options;

      if (!options.compiler) {
        for (let config of configs) {
          if (typeof config === 'function') {
            config = wrap(config);
          } else {
            toArray(config);
            timeFix(config);
          }
        }

        try {
          options.compiler = webpack(configs.length > 1 ? configs : configs[0]);
        } catch (e) {
          log.error('An error was thrown while initializing Webpack\n  ', e);
          process.exit(1);
        }
      }

      // if no context was specified in a config, and no --content options was
      // used, then we need to derive the context, and content location, from
      // the compiler.
      if (!options.content || !options.content.length) {
        options.content = [].concat(options.compiler.options.context || process.cwd());
      }

      const done = (stats) => {
        const json = stats.toJson();
        if (stats.hasErrors()) {
          bus.emit('compiler-error', json);
        }

        if (stats.hasWarnings()) {
          bus.emit('compiler-warning', json);
        }
      };

      if (options.compiler.hooks) {
        options.compiler.hooks.done.tap('WebpackServe', done);
      } else {
        options.compiler.plugin('done', done);
      }

      const { close, server, start } = getServer(options);

      start(options);

      for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => { // eslint-disable-line no-loop-func
          close(() => {
            log.info(`Process Ended via ${sig}`);
            server.kill();
            process.exit(0);
          });
        });
      }

      return Object.freeze({
        close,
        compiler: options.compiler,
        on(...args) {
          options.bus.on(...args);
        },
        options
      });
    });
};
