import { crypto } from '@binance-chain/javascript-sdk'
import { div } from 'biggystring'
import { entropyToMnemonic } from 'bip39'
import { Buffer } from 'buffer'
import {
  EdgeCurrencyInfo,
  EdgeCurrencyTools,
  EdgeEncodeUri,
  EdgeIo,
  EdgeMetaToken,
  EdgeParsedUri,
  EdgeWalletInfo
} from 'edge-core-js/types'

import { PluginEnvironment } from '../common/innerPlugin'
import { encodeUriCommon, parseUriCommon } from '../common/uriHelpers'
import { getDenomInfo } from '../common/utils'
import { BinanceNetworkInfo } from './bnbTypes'

const {
  checkAddress,
  getAddressFromPrivateKey,
  getPrivateKeyFromMnemonic,
  validateMnemonic
} = crypto

export class BinanceTools implements EdgeCurrencyTools {
  io: EdgeIo
  currencyInfo: EdgeCurrencyInfo

  constructor(env: PluginEnvironment<BinanceNetworkInfo>) {
    const { io, currencyInfo } = env
    this.io = io
    this.currencyInfo = currencyInfo
  }

  // will actually use MNEMONIC version of private key
  async importPrivateKey(mnemonic: string): Promise<Object> {
    const isValid = validateMnemonic(mnemonic)
    if (!isValid) throw new Error('Invalid BNB mnemonic')
    const binanceKey = getPrivateKeyFromMnemonic(mnemonic)

    return { binanceMnemonic: mnemonic, binanceKey }
  }

  async createPrivateKey(walletType: string): Promise<Object> {
    const type = walletType.replace('wallet:', '')

    if (type === 'binance') {
      const entropy = Buffer.from(this.io.random(32)).toString('hex')
      const binanceMnemonic = entropyToMnemonic(entropy)
      const binanceKey = getPrivateKeyFromMnemonic(binanceMnemonic)

      return { binanceMnemonic, binanceKey }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async derivePublicKey(walletInfo: EdgeWalletInfo): Promise<Object> {
    const type = walletInfo.type.replace('wallet:', '')
    if (type === 'binance') {
      let publicKey = ''
      let privateKey = walletInfo.keys.binanceKey
      if (typeof privateKey !== 'string') {
        privateKey = getPrivateKeyFromMnemonic(walletInfo.keys.binanceMnemonic)
      }
      publicKey = getAddressFromPrivateKey(privateKey, 'bnb')
      return { publicKey }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async parseUri(
    uri: string,
    currencyCode?: string,
    customTokens?: EdgeMetaToken[]
  ): Promise<EdgeParsedUri> {
    const networks = { binance: true }

    const { parsedUri, edgeParsedUri } = parseUriCommon(
      this.currencyInfo,
      uri,
      networks,
      currencyCode ?? 'BNB',
      customTokens
    )
    const address = edgeParsedUri.publicAddress ?? ''

    const valid = checkAddress(address, 'bnb')
    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }

    edgeParsedUri.uniqueIdentifier = parsedUri.query.memo
    return edgeParsedUri
  }

  async encodeUri(
    obj: EdgeEncodeUri,
    customTokens?: EdgeMetaToken[]
  ): Promise<string> {
    const { publicAddress, nativeAmount, currencyCode } = obj
    const valid = checkAddress(publicAddress, 'bnb')
    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }
    let amount
    if (typeof nativeAmount === 'string') {
      const denom = getDenomInfo(
        this.currencyInfo,
        currencyCode ?? 'BNB',
        customTokens
      )
      if (denom == null) {
        throw new Error('InternalErrorInvalidCurrencyCode')
      }
      amount = div(nativeAmount, denom.multiplier, 18)
    }
    const encodedUri = encodeUriCommon(obj, 'binance', amount)
    return encodedUri
  }
}

export async function makeCurrencyTools(
  env: PluginEnvironment<BinanceNetworkInfo>
): Promise<BinanceTools> {
  return new BinanceTools(env)
}

export { makeCurrencyEngine } from './bnbEngine'
