import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import * as A from 'fp-ts/lib/Array';
import { constant, pipe } from 'fp-ts/lib/function';
import { Service } from 'hap-nodejs';
import { CharacteristicValue } from 'homebridge';
import { match } from 'ts-pattern';
import { CapabilityState } from '../domain/alexa/get-device-states';
import * as util from '../util';
import BaseAccessory from './BaseAccessory';

export interface LightbulbState {
  namespace: keyof typeof LightbulbNamespaces;
  value: NonNullable<string | number | boolean>;
}
const LightbulbNamespaces = {
  'Alexa.PowerController': 0,
  'Alexa.BrightnessController': 1,
};

export default class LightAccessory extends BaseAccessory {
  private lightbulbService: Service;

  configureServices() {
    this.lightbulbService =
      this.accessory.getService(this.Service.Lightbulb) ||
      this.accessory.addService(
        this.Service.Lightbulb,
        this.device.displayName,
      );

    if (
      this.device.supportedOperations.includes('turnOn') &&
      this.device.supportedOperations.includes('turnOff')
    ) {
      this.lightbulbService
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.handleOnGet.bind(this))
        .onSet(this.handleOnSet.bind(this));
      this.addCharacteristicGetter(
        this.platform.Characteristic.On.UUID,
        'handleOnGet',
      );
    }

    if (this.device.supportedOperations.includes('setBrightness')) {
      this.lightbulbService
        .getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(this.handleBrightnessGet.bind(this))
        .onSet(this.handleBrightnessSet.bind(this));
      this.addCharacteristicGetter(
        this.platform.Characteristic.Brightness.UUID,
        'handleBrightnessGet',
      );
    }
  }

  async handleOnGet(): Promise<boolean> {
    this.logger.debug('Triggered GET Active');
    return pipe(
      this.platform.alexaApi.getLightbulbState(this.device.id),
      TE.match(
        (e) => {
          this.logger.errorT('handleOnGet', e);
          throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
          );
        },
        (states) =>
          states.find((s) => s.namespace === 'Alexa.PowerController')?.value ===
          'ON',
      ),
    )();
  }

  async handleOnSet(value: CharacteristicValue): Promise<void> {
    this.logger.debug('Triggered SET Active:', value);
    if (typeof value !== 'boolean') {
      return;
    }
    try {
      await pipe(
        this.platform.alexaApi.setLightbulbState(
          this.device.id,
          value ? 'turnOn' : 'turnOff',
        ),
        TE.flatMap(() => TE.sequenceArray(this.updateAllValues())),
      )();
    } catch (e) {
      this.logger.errorT('handleOnSet', e);
    }
  }

  async handleBrightnessGet(): Promise<number> {
    this.logger.debug('Triggered GET Brightness');
    return pipe(
      this.platform.alexaApi.getLightbulbState(this.device.id),
      TE.match(
        (e) => {
          this.logger.errorT('handleBrightnessGet', e);
          throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
          );
        },
        (states) =>
          ((states.find((s) => s.namespace === 'Alexa.BrightnessController')
            ?.value as number) ?? 0) * 100,
      ),
    )();
  }

  async handleBrightnessSet(value: CharacteristicValue): Promise<void> {
    this.logger.debug('Triggered SET Brightness:', value);
    if (typeof value !== 'number') {
      return;
    }
    try {
      await pipe(
        this.platform.alexaApi.setLightbulbState(
          this.device.id,
          'setBrightness',
          { brightness: (value / 100.0).toString(10) },
        ),
        TE.flatMap(() => TE.sequenceArray(this.updateAllValues())),
      )();
    } catch (e) {
      this.logger.errorT('handleBrightnessSet', e);
    }
  }

  static toLightCapabilities(capabilityStates?: string[]): LightbulbState[] {
    return pipe(
      capabilityStates ?? [],
      A.map((cs) => JSON.parse(cs) as CapabilityState),
      A.filterMap(({ namespace, value }) =>
        match([namespace, value])
          .when(
            ([ns, val]) =>
              Object.keys(LightbulbNamespaces).includes(ns ?? '') && !!val,
            ([ns, val]: [
              LightbulbState['namespace'],
              LightbulbState['value'],
            ]) => O.some({ namespace: ns, value: val }),
          )
          .otherwise(constant(O.none)),
      ),
      A.map(({ namespace, value }) => ({ namespace, value })),
    );
  }
}
