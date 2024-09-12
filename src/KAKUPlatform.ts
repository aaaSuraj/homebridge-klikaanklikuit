import {API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic} from 'homebridge';
import {Hub, SwitchDevice, DimDevice, ColorTemperatureDevice, Scene, Entity, RESTServer} from 'ics-2000';
import LightBulb from './devices/LightBulb';
import {PLATFORM_NAME, PLUGIN_NAME, RELOAD_SWITCH_NAME} from './settings';
import DimmableLightBulb from './devices/DimmableLightBulb';
import ReloadSwitch from './devices/ReloadSwitch';
import schedule from 'node-schedule';
import ColorTemperatureLightBulb from './devices/ColorTemperatureLightBulb';
import SceneDevice from './devices/SceneDevice';
import {Config} from './types';

export default class KAKUPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  private readonly cachedAccessories: PlatformAccessory[] = [];
  public readonly hub: Hub;
  private registeredDeviceIds: number[] = [];
  public readonly discoverMessage?: string;
  private readonly RESTServer?: RESTServer;

  constructor(
    public readonly logger: Logger,
    public readonly config: Config,
    public readonly api: API,
  ) {
    this.logger.debug('Finished initializing platform:', this.config.name);
    const {email, password} = config;

    if (!(email && password)) {
      throw new Error('E-mail and password are required');
    }

    const entityBlacklist = config.entityBlacklist ?? config.deviceBlacklist ?? [];

    if (entityBlacklist.length > 0) {
      this.logger.info(`Blacklist contains ${entityBlacklist.length} entities: ${entityBlacklist}`);
    }

    const {localBackupAddress} = config;

    if (localBackupAddress) {
      this.logger.info(`Using ${localBackupAddress!} as backup ip`);
    }

    const deviceConfigsOverrides = config.deviceConfigsOverrides ?? {};
    const keyCount = Object.keys(deviceConfigsOverrides).length;

    if (keyCount > 0) {
      this.logger.info(`Device config overrides contains ${keyCount} device types`);
    }

    this.discoverMessage = config.discoverMessage;

    if (this.discoverMessage) {
      this.logger.info(`Using custom discover message: ${this.discoverMessage!}`);
    }

    // Create a new Hub that's used in all accessories
    this.hub = new Hub(email, password, entityBlacklist, localBackupAddress, deviceConfigsOverrides);

    if (config.startRESTServer) {
      this.RESTServer = new RESTServer(true, this.hub);
    }

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      await this.setup();

      if (!this.config.hideReloadSwitch) {
        this.createReloadSwitch();
      } else {
        this.logger.info('Hiding reloading switch as specified in config');
      }

      if (config.startRESTServer) {
        const RESTServerPort = config.RESTServerPort ?? 9100;
        this.RESTServer?.listen(RESTServerPort)
          .then(() => this.logger.info('REST server started on port ' + RESTServerPort))
          .catch((error) => this.logger.error('Error starting REST server: ' + error));
      }

      // Rerun the setup every day so that the devices listed in HomeKit are up-to-date, the AES key for the command is up-to-date and
      // The local ip-address of your ics-2000 is up-to-date
      schedule.scheduleJob('0 0 * * *', async () => {
        this.logger.info('Pulling AES-key from server and searching for ics2000 as scheduled');
        // this.setup();
        const {isBackupAddress} = await this.hub.discoverHubLocal(10_000, this.discoverMessage);
        if (isBackupAddress) {
          this.searchTimeOutWarning();
        }
        await this.hub.login();
      });
    });
  }

  public async setup() {
      try {
          this.logger.info('Setup called!');
          await this.hub.login();
          await Promise.all([this.discoverDevices(), this.hub.getAllDeviceStatuses()]);
      } catch (error) {
          this.logger.error(`Setup failed: ${error.message}`);
      }
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.logger.debug('Loading accessory from cache:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  /**
   * Create a new instance of a Lightbulb
   * Currently, device types is limited to on/off switches (LightBulbs in this library)
   * and dimmable lights (DimmableLightBulb in this library)
   * I don't have other types of devices
   * @param accessory The accessory object you want to create a new Device with
   * @private
   */
  private createDevice(accessory: PlatformAccessory) {
    const {device} = accessory.context;

    if (device instanceof ColorTemperatureDevice) {
      new ColorTemperatureLightBulb(this, accessory);
    } else if (device instanceof DimDevice) {
      new DimmableLightBulb(this, accessory);
    } else if (device instanceof SwitchDevice) {
      new LightBulb(this, accessory);
    } else if (device instanceof Scene) {
      new SceneDevice(this, accessory);
    } else {
      throw new Error(`Device hasn't any controls: ${device.entityId} ${device.name} ${device.deviceType}`);
    }
  }

  private async discoverDevices() {
      try {
          // Log the start of the discovery process
          this.logger.info('Searching hub...');
          
          // Discover the hub locally
          const { address: hubIp, isBackupAddress } = await this.hub.discoverHubLocal(10_000, this.discoverMessage);
          if (isBackupAddress) this.searchTimeOutWarning();
          
          // Log the hub information
          this.logger.info(`Found hub: ${hubIp}`);
          
          // Pull and register the devices
          await this.pullAndRegisterDevices();
      } catch (error) {
          // Log any errors that occur during the discovery process
          this.logger.error(`Failed to discover devices: ${error.message}`);
      }
  }
  
  private async pullAndRegisterDevices() {
      try {
          // Log the start of device fetching
          this.logger.info('Pulling devices from server...');
          
          // Fetch raw device data
          const rawEntitiesData = await this.hub.getRawDevicesData(true, false);
          const foundDevices = await this.hub.getDevices(rawEntitiesData);
          
          // Filter enabled devices and optionally include scenes
          const allEntities = this.config.showScenes
              ? [...foundDevices, ...(await this.hub.getScenes(rawEntitiesData))]
              : foundDevices.filter(d => !d.disabled);
  
          // Log the number of devices found
          this.logger.info(`Found ${allEntities.length} devices`);
          
          // Register each device
          for (const entity of allEntities) {
              if (this.registeredDeviceIds.includes(entity.entityId)) continue;
              await this.registerDevice(entity);
          }
      } catch (error) {
          // Log errors during device fetching or registration
          this.logger.error(`Error pulling devices: ${error.message}`);
      }
  }
  
  private async registerDevice(entity: Entity) {
      try {
          // Generate a unique identifier for the device
          const uuid = this.api.hap.uuid.generate(entity.entityId.toString());
          const existingAccessory = this.cachedAccessories.find(accessory => accessory.UUID === uuid);
          
          // If the accessory already exists, update it; otherwise, create a new one
          if (existingAccessory) {
              existingAccessory.context.device = entity;
              this.createDevice(existingAccessory);
              this.logger.info(`Loaded entity from cache: name=${entity.name}, entityId=${entity.entityId}, deviceType=${entity.deviceType}`);
          } else {
              const accessory = new this.api.platformAccessory(entity.name, uuid);
              accessory.context.device = entity;
              this.createDevice(accessory);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
              this.logger.info(`Loaded new device: name=${entity.name}, entityId=${entity.entityId}, deviceType=${entity.deviceType}`);
          }
      } catch (error) {
          // Log any errors during the registration process
          this.logger.error(`Error registering device: ${error.message}`);
      }
  }


  
}
