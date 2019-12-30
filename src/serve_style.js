'use strict';

const path = require('path');
const fs = require('fs');

const clone = require('clone');
const express = require('express');

const utils = require('./utils');

module.exports = (options, repo, params, id, publicUrl, reportTiles, reportFont) => {
  const app = express().disable('x-powered-by');

  const styleFile = path.resolve(options.paths.styles, params.style);

  const styleJSON = clone(require(styleFile));
  for (const name of Object.keys(styleJSON.sources)) {
    const source = styleJSON.sources[name];
    const url = source.url;
    if (url && url.lastIndexOf('mbtiles:', 0) === 0) {
      let mbtilesFile = url.substring('mbtiles://'.length);
      const fromData = mbtilesFile[0] === '{' &&
        mbtilesFile[mbtilesFile.length - 1] === '}';

      if (fromData) {
        mbtilesFile = mbtilesFile.substr(1, mbtilesFile.length - 2);
        const mapsTo = (params.mapping || {})[mbtilesFile];
        if (mapsTo) {
          mbtilesFile = mapsTo;
        }
      }
      const identifier = reportTiles(mbtilesFile, fromData);
      source.url = `local://data/${identifier}.json`;
    }
  }

  for(let obj of styleJSON.layers) {
    if (obj['type'] === 'symbol') {
      const fonts = (obj['layout'] || {})['text-font'];
      if (fonts && fonts.length) {
        fonts.forEach(reportFont);
      } else {
        reportFont('Open Sans Regular');
        reportFont('Arial Unicode MS Regular');
      }
    }
  }

  let spritePath;

  const httpTester = /^(http(s)?:)?\/\//;
  if (styleJSON.sprite && !httpTester.test(styleJSON.sprite)) {
    spritePath = path.join(options.paths.sprites,
        styleJSON.sprite
            .replace('{style}', path.basename(styleFile, '.json'))
            .replace('{styleJsonFolder}', path.relative(options.paths.sprites, path.dirname(styleFile)))
            );
    styleJSON.sprite = `local://styles/${id}/sprite`;
  }
  if (styleJSON.glyphs && !httpTester.test(styleJSON.glyphs)) {
    styleJSON.glyphs = 'local://fonts/{fontstack}/{range}.pbf';
  }

  repo[id] = styleJSON;

  app.get(`/${id}/style.json`, (req, res, next) => {
    const fixUrl = (url, opt_nokey) => {
      if (!url || (typeof url !== 'string') || url.indexOf('local://') !== 0) {
        return url;
      }
      const queryParams = [];
      if (!opt_nokey && req.query.key) {
        queryParams.unshift(`key=${req.query.key}`);
      }
      let query = '';
      if (queryParams.length) {
        query = `?${queryParams.join('&')}`;
      }
      return url.replace(
        'local://', utils.getPublicUrl(publicUrl, req)) + query;
    };

    const styleJSON_ = clone(styleJSON);
    for (const name of Object.keys(styleJSON_.sources)) {
      const source = styleJSON_.sources[name];
      source.url = fixUrl(source.url);
    }
    // mapbox-gl-js viewer cannot handle sprite urls with query
    if (styleJSON_.sprite) {
      styleJSON_.sprite = fixUrl(styleJSON_.sprite, true);
    }
    if (styleJSON_.glyphs) {
      styleJSON_.glyphs = fixUrl(styleJSON_.glyphs, false);
    }
    return res.send(styleJSON_);
  });

  app.get(`/${id}/sprite:scale(@[23]x)?.:format([\\w]+)`,
    (req, res, next) => {
    if (!spritePath) {
      return res.status(404).send('File not found');
    }
        const scale = req.params.scale,
          format = req.params.format;
        const filename = `${spritePath + (scale || '')}.${format}`;
        return fs.readFile(filename, (err, data) => {
      if (err) {
        console.log('Sprite load error:', filename);
        return res.status(404).send('File not found');
      } else {
        if (format === 'json') res.header('Content-type', 'application/json');
        if (format === 'png') res.header('Content-type', 'image/png');
        return res.send(data);
      }
    });
  });

  return Promise.resolve(app);
};
