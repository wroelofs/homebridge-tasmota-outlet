'use strict';

const path = require('path');
const axios = require('axios').default;
const fs = require('fs');

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
        const deviceName = this.devices[i];
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
    this.refreshInterval = config.refreshInterval || 5;
    this.disableLogInfo = config.disableLogInfo;

    //get Device info
    this.manufacturer = config.manufacturer || 'Gosund';
    this.modelName = config.modelName || 'SP111';
    this.serialNumber = config.serialNumber || 'Serial Number';
    this.firmwareRevision = config.firmwareRevision || 'Firmware Revision';

    //setup variables
    this.checkDeviceInfo = true;
    this.checkDeviceState = false;
    this.startPrepareAccessory = true;
    this.powerState = false;
    this.prefDir = path.join(api.user.storagePath(), 'tasmota');
    this.auth_url = '?user=' + this.user + '&password=' + this.passwd;
    this.url = 'http://' + this.host + '/cm' + this.auth_url + '&cmnd='

    //check if prefs directory ends with a /, if not then add it
    if (this.prefDir.endsWith('/') == false) {
      this.prefDir = this.prefDir + '/';
    }
    //check if the directory exists, if not then create it
    if (fs.existsSync(this.prefDir) == false) {
      fsPromises.mkdir(this.prefDir);
    }

    //Check device state
    setInterval(function () {
      if (this.checkDeviceInfo) {
        this.getDeviceInfo();
      }
      if (this.checkDeviceState) {
        this.updateDeviceState();
      }
    }.bind(this), this.refreshInterval * 1000);

    //start prepare accessory
    if (this.startPrepareAccessory) {
      this.prepareAccessory();
    }
  }

  async getDeviceInfo() {
    this.log.debug('Device: %s %s, requesting Device Info.', this.host, this.name);
    try {
      const response = await axios.request(this.url + POWER_STATE);
      const powerState = (response.data['POWER'] == 'ON');
      this.log('Device: %s, state: Online.', this.name);
      this.log('-------- %s --------', this.name);
      this.log('Manufacturer: %s', this.manufacturer);
      this.log('Model: %s', this.modelName);
      this.log('Serialnr: %s', this.serialNumber);
      this.log('Firmware: %s', this.firmwareRevision);
      this.log('State: %s', powerState ? 'ON' : 'OFF');
      this.log('----------------------------------');

      this.checkDeviceInfo = false;
      this.updateDeviceState();
    } catch (error) {
      this.log.error('Device: %s %s, Device Info eror: %s, state: Offline, trying to reconnect', this.host, this.name, error);
      this.checkDeviceInfo = true;
    }
  }

  async updateDeviceState() {
    this.log.debug('Device: %s %s, requesting Device state.', this.host, this.name);
    try {
      const response = await axios.request(this.url + POWER_STATE);
      this.log.debug('Device: %s %s, debug response: %s', this.host, this.name, response.data);
      const powerState = (response.data['POWER'] != undefined) ? (response.data['POWER'] == 'ON') : false;
      if (this.tasmotaService) {
        this.tasmotaService
          .updateCharacteristic(Characteristic.OutletInUse, powerState);
      }
      this.powerState = powerState;

      this.checkDeviceState = true;
    } catch (error) {
      this.log.error('Device: %s %s, update Device state error: %s, state: Offline', this.host, this.name, error);
      this.checkDeviceState = false;
      this.checkDeviceInfo = true;
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
    this.log.debug('prepareTasmotaService');
    this.tasmotaService = new Service.Outlet(accessoryName, 'tasmotaService');
    this.tasmotaService.getCharacteristic(Characteristic.On)
      .onGet(async () => {
        const state = this.powerState;
        if (!this.disableLogInfo) {
          this.log('Device: %s, get state: %s', accessoryName, state ? 'ON' : 'OFF');
        }
        return state;
      })
      .onSet(async (state) => {
        state = state ? POWERON : POWEROFF;
        axios.request(this.url + state);
        if (!this.disableLogInfo) {
          this.log('Device: %s, set state: %s', accessoryName, state ? 'ON' : 'OFF');
        }
      });
    this.tasmotaService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(async () => {
        const state = this.powerState;
        if (!this.disableLogInfo) {
          this.log('Device: %s, in use: %s', accessoryName, state ? 'YES' : 'NO');
        }
        return state;
      });
    accessory.addService(this.tasmotaService);

    this.startPrepareAccessory = false;
    this.log.debug('Device: %s %s, publishExternalAccessories.', this.host, accessoryName);
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }
}
