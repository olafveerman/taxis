const async = require('async')
const fs = require('fs-extra')
const omit = require('lodash.omit')
const parse = require('csv-parse')
const lib = require('./lib.js')

async.parallel([
  function (cb) {
    // Parse area data about the concelhos
    parse(fs.readFileSync('./data/concelhos.csv'), {columns: true}, function (err, output) {
      cb(err, output)
    })
  },
  function (cb) {
    // Parse meta-data for each concelho
    parse(fs.readFileSync('./data/area-abbreviations.csv'), {columns: true}, function (err, output) {
      cb(err, output)
    })
  },
  function (cb) {
    // Parse the contents of the files folder
    let data = lib.parseFileFolder()
    cb(null, data)
  },
  function (cb) {
    // Parse meta-data for each concelho
    parse(fs.readFileSync('./data/area-metadata.csv'), {columns: true}, function (err, output) {
      // Parse any column that contains an array
      let data = lib.parseMultiValueField(output, lib.getMultiValueFields(output))
      cb(err, data)
    })
  },
  function (cb) {
    // Parse time series data with taxis by concelho
    // Returns an array of records for a unique concelho, year, indicator
    parse(fs.readFileSync('./data/taxis.csv'), {columns: true}, function (err, output) {
      let data = lib.backfillData(lib.prepTsData(output))
      cb(err, data)
    })
  },
  function (cb) {
    // Parse time series data with population estimates by concelho
    // Returns an array of records for each concelho + year
    parse(fs.readFileSync('./data/population.csv'), {columns: true}, function (err, output) {
      let data = lib.prepTsData(output)
      cb(err, data)
    })
  },
  function (cb) {
    // Parse time series data with population estimates by concelho
    // Returns an array of records for each concelho + year
    parse(fs.readFileSync('./data/dormidas.csv'), {columns: true}, function (err, output) {
      let data = lib.prepTsData(output)
      cb(err, data)
    })
  }
],
function (err, results) {
  if (err) { console.log(err.message) }

  // Generate base objects for all admin areas
  const areas = lib.generateAreas(results[0], results[1], results[2])

  // Combine the admin areas with the meta data (results[2])
  const areasWithMeta = areas.map(area => lib.addMetaData(area, results[3]))

  // Merge the Time Series data: taxi data (results[4]), the population
  // estimates (results[5]), dormidas (results[6]) and back-fill the nulls
  const tsData = [].concat(results[4], results[5], results[6])

  // Combine the admin areas with the Time Series data
  const processedData = areasWithMeta.map(area => lib.addTsData(area, tsData))

  // Generate a JSON file for each admin area type
  var tasks = lib.uniqueValues(areas, 'type').map(type => {
    return function (cb) {
      const data = processedData.filter(o => o.type === type)
      lib.storeResponse(
        data,
        `${type}-full.json`,
        `Data about taxis in Portugal from 2006 on, aggregated by ${type}`
      )
      cb()
    }
  })

  // Generate a JSON file with data for all districts and concelhos
  tasks.push(
    function (cb) {
      let data = processedData
        .filter(o => o.type === 'nut3')
        .map(d => {
          d.concelhos = d.concelhos.map(c => processedData.find(p => p.id === c))
          return d
        })

      // The national data on dormidas can't be aggregated from concelhos
      data.push(require('../data/national-dormidas.json'))

      lib.storeResponse(
        data,
        'national.json',
        'Data about taxis in Portugal from 2006 on, aggregated by NUT3 and concelho'
      )
      cb()
    })

  // Generate a a light-weight JSON file with the hierarchy of admin areas for the menu
  tasks.push(
    function (cb) {
      const data = processedData
        .filter(o => o.type === 'nut3')
        .map(d => {
          d.concelhos = d.concelhos.map(c => {
            let match = processedData.find(p => p.id === c.id)
            return omit(match, ['type', 'concelhos', 'data'])
          })
          return omit(d, ['type', 'data'])
        })
      lib.storeResponse(
        data,
        'national-menu.json',
        'The NUT3 areas with their concelhos'
      )
      cb()
    })

  // Generate a TopoJSON file with only geometries, and another one with data for all areas
  const topo = JSON.parse(fs.readFileSync('./data/admin-areas.topojson'))
  tasks.push(
    function (cb) {
      fs.copy('./data/admin-areas.topojson', './export/admin-areas.topojson')
      fs.writeFileSync('./export/admin-areas-data.topojson', JSON.stringify(lib.joinTopo(topo, processedData, 'id')))
      cb()
    }
  )

  async.parallel(tasks, function (err) {
    if (err) { console.log(err.message) }
    console.log('Done!')
  })
})
