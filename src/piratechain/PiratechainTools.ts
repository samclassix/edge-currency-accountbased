import { div } from 'biggystring'
import { entropyToMnemonic, validateMnemonic } from 'bip39'
import { Buffer } from 'buffer'
import {
  EdgeCurrencyInfo,
  EdgeCurrencyTools,
  EdgeEncodeUri,
  EdgeIo,
  EdgeMetaToken,
  EdgeParsedUri,
  EdgeTokenMap,
  EdgeWalletInfo,
  JsonObject
} from 'edge-core-js/types'
import { Tools as ToolsType } from 'react-native-piratechain'

import { PluginEnvironment } from '../common/innerPlugin'
import { asIntegerString } from '../common/types'
import { encodeUriCommon, parseUriCommon } from '../common/uriHelpers'
import { getLegacyDenomination, mergeDeeply } from '../common/utils'
import type { PiratechainIo } from './piratechainIo'
import {
  asArrrPublicKey,
  asPiratechainPrivateKeys,
  asSafePiratechainWalletInfo,
  PiratechainInfoPayload,
  PiratechainNetworkInfo
} from './piratechainTypes'

export class PiratechainTools implements EdgeCurrencyTools {
  builtinTokens: EdgeTokenMap
  currencyInfo: EdgeCurrencyInfo
  io: EdgeIo
  networkInfo: PiratechainNetworkInfo
  nativeTools: typeof ToolsType

  constructor(env: PluginEnvironment<PiratechainNetworkInfo>) {
    const { builtinTokens, currencyInfo, io, networkInfo } = env
    this.builtinTokens = builtinTokens
    this.currencyInfo = currencyInfo
    this.io = io
    this.networkInfo = networkInfo

    const piratechainIo =
      (env.nativeIo.piratechain as PiratechainIo) ??
      env.nativeIo['edge-currency-accountbased']?.piratechain
    if (piratechainIo == null) {
      throw new Error('Need piratechain native IO')
    }

    this.nativeTools = piratechainIo.Tools
  }

  async getDisplayPrivateKey(
    privateWalletInfo: EdgeWalletInfo
  ): Promise<string> {
    const { pluginId } = this.currencyInfo
    const keys = asPiratechainPrivateKeys(pluginId)(privateWalletInfo.keys)
    return `Seed Phrase:\n${keys.mnemonic}\n\nBirthday Height:\n${keys.birthdayHeight}`
  }

  async getDisplayPublicKey(publicWalletInfo: EdgeWalletInfo): Promise<string> {
    const { keys } = asSafePiratechainWalletInfo(publicWalletInfo)
    return keys.publicKey
  }

  async getNewWalletBirthdayBlockheight(): Promise<number> {
    return await this.nativeTools.getBirthdayHeight(
      this.networkInfo.rpcNode.defaultHost,
      this.networkInfo.rpcNode.defaultPort
    )
  }

  async isValidAddress(address: string): Promise<boolean> {
    return await this.nativeTools.isValidAddress(address)
  }

  // will actually use MNEMONIC version of private key
  async importPrivateKey(
    userInput: string,
    opts: JsonObject = {}
  ): Promise<Object> {
    const { pluginId } = this.currencyInfo
    const isValid = validateMnemonic(userInput)
    if (userInput.split(' ').length !== 24) {
      throw new Error('Mnemonic must be 24 words')
    }
    if (!isValid)
      throw new Error(`Invalid ${this.currencyInfo.currencyCode} mnemonic`)

    // Get current network height for the birthday height
    const currentNetworkHeight = await this.getNewWalletBirthdayBlockheight()

    let height = currentNetworkHeight

    const { birthdayHeight } = opts
    if (birthdayHeight != null) {
      asIntegerString(birthdayHeight)

      const birthdayHeightInt = parseInt(birthdayHeight)

      if (birthdayHeightInt > currentNetworkHeight) {
        throw new Error('InvalidBirthdayHeight') // must be less than current block height (assuming query was successful)
      }
      height = birthdayHeightInt
    }

    return {
      [`${pluginId}Mnemonic`]: userInput,
      [`${pluginId}BirthdayHeight`]: height
    }
  }

  async createPrivateKey(walletType: string): Promise<Object> {
    if (walletType !== this.currencyInfo.walletType) {
      throw new Error('InvalidWalletType')
    }

    const entropy = Buffer.from(this.io.random(32)).toString('hex')
    const mnemonic = entropyToMnemonic(entropy)
    return await this.importPrivateKey(mnemonic)
  }

  async checkPublicKey(publicKey: JsonObject): Promise<boolean> {
    try {
      const keys = asArrrPublicKey(publicKey)
      return keys.publicKey.length > 0 // return false if sdk wasn't present when public key was derived
    } catch (err) {
      return false
    }
  }

  async derivePublicKey(walletInfo: EdgeWalletInfo): Promise<Object> {
    const { pluginId } = this.currencyInfo
    const piratechainPrivateKeys = asPiratechainPrivateKeys(pluginId)(
      walletInfo.keys
    )
    if (walletInfo.type !== this.currencyInfo.walletType) {
      throw new Error('InvalidWalletType')
    }

    const mnemonic = piratechainPrivateKeys.mnemonic
    if (typeof mnemonic !== 'string') {
      throw new Error('InvalidMnemonic')
    }
    const unifiedViewingKey: string = await this.nativeTools.deriveViewingKey(
      mnemonic,
      this.networkInfo.rpcNode.networkName
    )
    return {
      birthdayHeight: piratechainPrivateKeys.birthdayHeight,
      publicKey: unifiedViewingKey
    }
  }

  async parseUri(
    uri: string,
    currencyCode?: string,
    customTokens?: EdgeMetaToken[]
  ): Promise<EdgeParsedUri> {
    const { pluginId } = this.currencyInfo
    const networks = { [pluginId]: true }

    const {
      edgeParsedUri,
      edgeParsedUri: { publicAddress }
    } = await parseUriCommon({
      currencyInfo: this.currencyInfo,
      uri,
      networks,
      builtinTokens: this.builtinTokens,
      currencyCode: currencyCode ?? this.currencyInfo.currencyCode,
      customTokens
    })

    if (publicAddress == null || !(await this.isValidAddress(publicAddress))) {
      throw new Error('InvalidPublicAddressError')
    }

    return edgeParsedUri
  }

  async encodeUri(
    obj: EdgeEncodeUri,
    customTokens: EdgeMetaToken[] = []
  ): Promise<string> {
    const { pluginId } = this.currencyInfo
    const { nativeAmount, currencyCode, publicAddress } = obj

    if (!(await this.isValidAddress(publicAddress))) {
      throw new Error('InvalidPublicAddressError')
    }

    let amount
    if (nativeAmount != null) {
      const denom = getLegacyDenomination(
        currencyCode ?? this.currencyInfo.currencyCode,
        this.currencyInfo,
        customTokens,
        this.builtinTokens
      )
      if (denom == null) {
        throw new Error('InternalErrorInvalidCurrencyCode')
      }
      amount = div(nativeAmount, denom.multiplier, 18)
    }
    const encodedUri = encodeUriCommon(obj, `${pluginId}`, amount)
    return encodedUri
  }
}

export async function makeCurrencyTools(
  env: PluginEnvironment<PiratechainNetworkInfo>
): Promise<PiratechainTools> {
  return new PiratechainTools(env)
}

export async function updateInfoPayload(
  env: PluginEnvironment<PiratechainNetworkInfo>,
  infoPayload: PiratechainInfoPayload
): Promise<void> {
  // In the future, other fields might not be "network info" fields
  const { ...networkInfo } = infoPayload

  // Update plugin NetworkInfo:
  env.networkInfo = mergeDeeply(env.networkInfo, networkInfo)
}

export { makeCurrencyEngine } from './PiratechainEngine'
