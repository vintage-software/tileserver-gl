'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const clone = require('clone');
const express = require('express');
const MBTiles = require('@mapbox/mbtiles');
const Pbf = require('pbf');
const VectorTile = require('@mapbox/vector-tile').VectorTile;

const utils = require('./utils');

module.exports = (options, repo, params, id, styles, publicUrl) => {
  const app = express().disable('x-powered-by');

  const mbtilesFile = path.resolve(options.paths.mbtiles, params.mbtiles);
  let tileJSON = {
    'tiles': params.domains || options.domains
  };

  repo[id] = tileJSON;

  const mbtilesFileStats = fs.statSync(mbtilesFile);
  if (!mbtilesFileStats.isFile() || mbtilesFileStats.size === 0) {
    throw Error(`Not valid MBTiles file: ${mbtilesFile}`);
  }
  let source;
  const sourceInfoPromise = new Promise((resolve, reject) => {
    source = new MBTiles(mbtilesFile, err => {
      if (err) {
        reject(err);
        return;
      }
      source.getInfo((err, info) => {
        if (err) {
          reject(err);
          return;
        }
        tileJSON['name'] = id;
        tileJSON['format'] = 'pbf';

        Object.assign(tileJSON, info);

        tileJSON['tilejson'] = '2.0.0';
        delete tileJSON['filesize'];
        delete tileJSON['mtime'];
        delete tileJSON['scheme'];

        Object.assign(tileJSON, params.tilejson || {});
        utils.fixTileJSONCenter(tileJSON);

        if (options.dataDecoratorFunc) {
          tileJSON = options.dataDecoratorFunc(id, 'tilejson', tileJSON);
        }
        resolve();
      });
    });
  });

  const tilePattern = `/${id}/:z(\\d+)/:x(\\d+)/:y(\\d+).:format([\\w.]+)`;

  app.get(tilePattern, (req, res, next) => {
    const z = req.params.z | 0;
    const x = req.params.x | 0;
    const y = req.params.y | 0;
    let format = req.params.format;
    if (format === options.pbfAlias) {
      format = 'pbf';
    }
    if (format !== tileJSON.format &&
        !(format === 'geojson' && tileJSON.format === 'pbf')) {
      return res.status(404).send('Invalid format');
    }
    if (z < tileJSON.minzoom || 0 || x < 0 || y < 0 ||
        z > tileJSON.maxzoom ||
        x >= Math.pow(2, z) || y >= Math.pow(2, z)) {
      return res.status(404).send('Out of bounds');
    }
    source.getTile(z, x, y, (err, data, headers) => {
      let isGzipped;
      if (err) {
        if (/does not exist/.test(err.message)) {
          return res.status(204).send();
        } else {
          return res.status(500).send(err.message);
        }
      } else {
        if (data == null) {
          return res.status(404).send('Not found');
        } else {
          if (tileJSON['format'] === 'pbf') {
            isGzipped = data.slice(0, 2).indexOf(
              Buffer.from([0x1f, 0x8b])) === 0;
            if (options.dataDecoratorFunc) {
              if (isGzipped) {
                data = zlib.unzipSync(data);
                isGzipped = false;
              }
              data = options.dataDecoratorFunc(id, 'data', data, z, x, y);
            }
          }
          if (format === 'pbf') {
            headers['Content-Type'] = 'application/x-protobuf';
          } else if (format === 'geojson') {
            headers['Content-Type'] = 'application/json';

            if (isGzipped) {
              data = zlib.unzipSync(data);
              isGzipped = false;
            }

            const tile = new VectorTile(new Pbf(data));
            const geojson = {
              "type": "FeatureCollection",
              "features": []
            };
            for (let layerName in tile.layers) {
              const layer = tile.layers[layerName];
              for (let i = 0; i < layer.length; i++) {
                const feature = layer.feature(i);
                const featureGeoJSON = feature.toGeoJSON(x, y, z);
                featureGeoJSON.properties.layer = layerName;
                geojson.features.push(featureGeoJSON);
              }
            }
            data = JSON.stringify(geojson);
          }
          delete headers['ETag']; // do not trust the tile ETag -- regenerate
          headers['Content-Encoding'] = 'gzip';
          res.set(headers);

          if (!isGzipped) {
            data = zlib.gzipSync(data);
            isGzipped = true;
          }

          return res.status(200).send(data);
        }
      }
    });
  });

  app.get(`/${id}.json`, (req, res, next) => {
    const info = clone(tileJSON);
    info.tiles = utils.getTileUrls(req, info.tiles,
                                   `data/${id}`, info.format, publicUrl, {
                                     'pbf': options.pbfAlias
                                   });
    return res.send(info);
  });

  return sourceInfoPromise.then(() => app);
};
