export interface TrendingToken {
  address: string;
  rank: number;
  symbol: string;
  name: string;
}

export interface JupiterTokenData {
  baseToken: {
    address: string;
    symbol: string;
    name: string;
  };
  priceNative: string;
  marketCap: number;
  volume: {
    h1: number;
  };
  liquidity: {
    base: number;
  };
  priceChange: {
    h1: number;
  };
  baseAsset?: {
    stats1h?: {
      buyOrganicVolume?: number;
      sellOrganicVolume?: number;
      numOrganicBuyers?: number;
    };
    organicScore?: number;
  };
}

export interface TokenAnalysis {
  address: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume1h: number;
  volumeToMarketCap: number;
  volumeToLiquidity: number;
  priceChange1h: number;
  // New Jupiter metrics
  organicVolume1h?: number;
  organicBuyerCount?: number;
  organicScore?: number;
  compositeScore?: number;
}

export interface SelectedToken {
  address: string;
  symbol: string;
  name: string;
  entryPrice: number;
  entryTime: Date;
  volumeToMarketCapAtEntry: number;
  compositeScoreAtEntry?: number;
  lastAnalyzed: Date;
  isActive: boolean;
}
