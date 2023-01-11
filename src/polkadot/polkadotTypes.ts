import {
  asArray,
  asBoolean,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'

export interface PolkadotSettings {
  rpcNodes: string[]
  genesisHash: string
  existentialDeposit: string
  subscanBaseUrl: string
  subscanQueryLimit: number
  lengthFeePerByte: string
}

export interface PolkadotOtherData {
  txCount: number
}

export const asSubscanResponse = asObject({
  code: asNumber,
  message: asString,
  data: asOptional(asObject(asUnknown))
})

export type SubscanResponse = ReturnType<typeof asSubscanResponse>

// https://docs.api.subscan.io/#transfers
export const asTransfer = asObject({
  from: asString,
  to: asString,
  success: asBoolean,
  hash: asString,
  block_num: asNumber,
  block_timestamp: asNumber,
  module: asString,
  amount: asString,
  fee: asString
})

export type SubscanTx = ReturnType<typeof asTransfer>

export const asTransactions = asObject({
  count: asNumber,
  transfers: asMaybe(asArray(asTransfer), [])
})

export interface SdkBalance {
  nonce: number
  consumers: number
  providers: number
  sufficients: number
  data: {
    free: number
    reserved: number
    miscFrozen: number
    feeFrozen: number
  }
}

export interface SdkBlockHeight {
  block: {
    header: {
      parentHash: string
      number: number
      stateRoot: string
      extrinsicsRoot: string
    }
  }
}

export interface SdkPaymentInfo {
  weight: number // 137709000,
  class: string // 'Normal',
  partialFee: number // s152000016
}
