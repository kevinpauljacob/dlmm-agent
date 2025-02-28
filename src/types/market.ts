export interface TrendingToken {
  address: string;
  rank: number;
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
}

export interface SelectedToken {
  address: string;
  symbol: string;
  name: string;
  entryPrice: number;
  entryTime: Date;
  volumeToMarketCapAtEntry: number;
  lastAnalyzed: Date;
  isActive: boolean;
}

export type DexScreenerTokenBoost = {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon: string;
  header: string;
  openGraph: string;
  description?: string;
  links: {
    type?: string;
    label?: string;
    url: string;
  }[];
  totalAmount: number;
};

export type DexScreenerPairData = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info: {
    imageUrl: string;
    header: string;
    openGraph: string;
    websites?: Array<{ label: string; url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
};
