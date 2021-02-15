'use strict';

const request = require('request');
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');

const POWER_STATE = 'Power';
const POWERON = 'Power%201';
const POWEROFF = 'Power%200';

const PLUGIN_NAME = 'homebridge-tasmota-outlet';
const PLATFORM_NAME = 'tasmotaOutlet';

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
  Accessory = api.platformAccessory;
  Characteristic = api.hap.Characteristic;
  Service = api.hap.Service;
  Categories = api.hap.Categories;
  UUID = api.hap.uuid;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, tasmotaPlatform, true);
}

class tasmotaPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log('No configuration found for %s', PLUGIN_NAME);
      return;
    }
    this.log = log;
    this.config = config;
    this.api = api;
    this.devices = config.devices || [];

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching');
      for (let i = 0; i < this.devices.length; i++) {
        let deviceName = this.devices[i];
        if (!deviceName.name) {
          this.log.warn('Device Name Missing');
        } else {
          new tasmotaDevice(this.log, deviceName, this.api);
        }
      }
    });

  }

  configureAccessory(platformAccessory) {
    this.log.debug('configurePlatformAccessory');
  }

  removeAccessory(platformAccessory) {
    this.log.debug('removePlatformAccessory');
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
  }
}

class tasmotaDevice {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config;


    //device configuration
    this.name = config.name;
    this.host = config.host;
    this.user = config.user;
    this.passwd = config.passwd;
    this.refreshInterval = config.refreshInterval || 10;

    //get Device info
    this.manufacturer = config.manufacturer || 'Gosund';
    this.modelName = config.modelName || 'SP111';
    this.serialNumber = config.serialNumber || 'Serial Number';
    this.firmwareRevision = config.firmwareRevision || 'Firmware Revision';

    //setup variables
    this.checkDeviceInfo = false;
    this.checkDeviceState = false;
    this.startPrepareAccessory = true;
    this.deviceDataOK = false;
    this.powerState = false;
    this.prefDir = path.join(api.user.storagePath(), 'tasmota');
    this.auth_url = '?user=' + this.user + '&password=' + this.passwd;
    this.url = 'http://' + this.host + '/cm' + this.auth_url + '&cmnd='

    //check if prefs directory ends with a /, if not then add it
    if (this.prefDir.endsWith('/') === false) {
      this.prefDir = this.prefDir + '/';
    }

    //check if the directory exists, if not then create it
    if (fs.existsSync(this.prefDir) === false) {
      fs.mkdir(this.prefDir, { recursive: false }, (error) => {
        if (error) {
          this.log.error('Device: %s , create directory: %s, error: %s', this.name, this.prefDir, error);
        } else {
          this.log.debug('Device: %s , create directory successful: %s', this.name, this.prefDir);
        }
      });
    }

    //Check device state
    setInterval(function () {
      if (this.checkDeviceInfo) {
        this.getDeviceInfo();
      } else if (!this.checkDeviceInfo && this.checkDeviceState) {
        this.updateDeviceState();
      }
    }.bind(this), this.refreshInterval * 1000);

    this.getDeviceInfo()
  }

  async getDeviceInfo() {
    var me = this;
    try {
      me.log.info('Device: %s, state: Online.', me.name);
      me.log('-------- %s --------', me.name);
      me.log('Manufacturer: %s', me.manufacturer);
      me.log('Model: %s', me.modelName);
      me.log('Serialnr: %s', me.serialNumber);
      me.log('Firmware: %s', me.firmwareRevision);
      me.log('----------------------------------');

      me.checkDeviceInfo = false;
      me.updateDeviceState();
    } catch (error) {
      me.log.error('Device: %s, getDeviceInfo error: %s', me.name, error);
      me.checkDeviceInfo = true;
    }
  }

  updateDeviceState() {
    var me = this;
    try {
      request(me.url + POWER_STATE, function (error, response, body) {
        me.log.debug('Device %s, get device status data: %s', me.name, body);
        var data = JSON.parse(body);
        if (data !== 'undefined') {
          let powerState = (data['POWER'] === 'ON') ? 1 : 0;
          if (me.tasmotaService) {
            me.tasmotaService.updateCharacteristic(Characteristic.OutletInUse, powerState);
            me.log.debug('Device: %s, state: %s', me.name, powerState ? 'ON' : 'OFF');
          }
          me.powerState = powerState;
          me.deviceDataOK = true;
        }
      });
      me.checkDeviceState = true;

      //start prepare accessory
      if (me.startPrepareAccessory) {
        me.prepareAccessory();
      }
    } catch (error) {
      me.log.error('Device: %s, update status error: %s, state: Offline', me.name, error);
      me.checkDeviceState = false;
      me.checkDeviceInfo = true;
    }
  }

  //Prepare accessory
  prepareAccessory() {
    this.log.debug('prepareAccessory');
    const accessoryName = this.name;
    const accessoryUUID = UUID.generate(accessoryName);
    const accessoryCategory = Categories.OTHER;
    const accessory = new Accessory(accessoryName, accessoryUUID, accessoryCategory);

    //Prepare information service
    this.log.debug('prepareInformationService');
    this.getDeviceInfo();

    const manufacturer = this.manufacturer;
    const modelName = this.modelName;
    const serialNumber = this.serialNumber;
    const firmwareRevision = this.firmwareRevision;

    accessory.removeService(accessory.getService(Service.AccessoryInformation));
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Name, accessoryName)
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.Model, modelName)
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, firmwareRevision);

    accessory.addService(informationService);

    //Prepare service 
    this.log.debug('preparetasmotaService');
    if (this.deviceDataOK) {
      this.tasmotaService = new Service.Outlet(accessoryName, 'tasmotaService');
      this.tasmotaService.getCharacteristic(Characteristic.On)
        .on('get', (callback) => {
          let state = this.powerState;
          this.log.info('Device: %s, state: %s', accessoryName, state ? 'ON' : 'OFF');
          callback(null, state);
        })
        .on('set', (value, callback) => {
          let state = value ? POWERON : POWEROFF;
          request(this.url + state);
          this.log.info('Device: %s, state: %s', accessoryName, state ? 'ON' : 'OFF');
          callback(null);
        });
      this.tasmotaService.getCharacteristic(Characteristic.OutletInUse)
        .on('get', (callback) => {
          let state = this.powerState;
          this.log.info('Device: %s, in use: %s', accessoryName, state ? 'YES' : 'NO');
          callback(null, state);
        });
      accessory.addService(this.tasmotaService);
    }

    this.startPrepareAccessory = false;
    this.log.debug('Device: %s %s, publishExternalAccessories.', this.host, accessoryName);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }
}
