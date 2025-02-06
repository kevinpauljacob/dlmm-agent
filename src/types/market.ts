export interface TokenMarketData {
  address: string;
  price: number;
  liquidity: number;
  supply: number;
  marketcap: number;
  circulating_supply: number;
  circulating_marketcap: number;
}

export interface TokenTradeData {
  address: string;
  price: number;
  volume_1h: number;
  volume_1h_usd: number;
  price_change_1h_percent: number;
  last_trade_unix_time: number;
}

export interface TrendingToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  rank: number;
}

export interface TokenAnalysis {
  address: string;
  symbol: string;
  name: string;
  price: number;
  marketcap: number;
  volume1h: number;
  volumeToMarketcap: number;
  volumeToLiquidity: number;
  priceChange1h: number;
}

export interface SelectedToken {
  address: string;
  symbol: string;
  name: string;
  entryPrice: number;
  entryTime: Date;
  volumeToMarketcapAtEntry: number;
  lastAnalyzed: Date;
  isActive: boolean;
}
