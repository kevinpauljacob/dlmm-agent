import axios from "axios";
import {
  type TokenMarketData,
  type TokenTradeData,
  type TrendingToken,
  type TokenAnalysis,
  type SelectedToken,
} from "../types/market";
import { Token } from "../models/token";
import connectToDatabase from "../utils/database";
import { config } from "dotenv";
config();

const API_KEY =
  process.env.BIRDEYE_API_KEY || "da0c0fc3a584493f94119e5b559c4a54";
const BASE_URL = "https://public-api.birdeye.so";
const TRENDING_TOKENS_LIMIT = 5;

const headers = {
  accept: "application/json",
  "x-chain": "solana",
  "X-API-KEY": API_KEY,
};

export async function getTrendingTokens(
  limit: number
): Promise<TrendingToken[]> {
  try {
    const response = await axios.get(
      `${BASE_URL}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`,
      { headers }
    );
    return response.data.data.tokens;
  } catch (error) {
    console.error("Error fetching trending tokens:", error);
    throw error;
  }
}

export async function getTokenMarketData(
  address: string
): Promise<TokenMarketData> {
  try {
    console.log("Fetching market data for", address);
    const response = await axios.get(
      `${BASE_URL}/defi/v3/token/market-data?address=${address}`,
      { headers }
    );
    return response.data.data;
  } catch (error) {
    console.error(`Error fetching market data for ${address}:`, error);
    throw error;
  }
}

export async function getTokenTradeData(
  address: string
): Promise<TokenTradeData> {
  console.log("Fetching trade data for", address);
  try {
    const response = await axios.get(
      `${BASE_URL}/defi/v3/token/trade-data/single?address=${address}`,
      { headers }
    );
    return response.data.data;
  } catch (error) {
    console.error(`Error fetching trade data for ${address}:`, error);
    throw error;
  }
}

export async function getBestTradingOpportunity(): Promise<{
  analysis: TokenAnalysis;
  selectedToken: SelectedToken;
} | null> {
  try {
    await connectToDatabase();
    // Get top 5 trending tokens
    console.log(`Get top 5 trending tokens`);
    const trendingTokens = await getTrendingTokens(TRENDING_TOKENS_LIMIT);

    // Analyze each token
    const analyses = await Promise.all(
      trendingTokens.map(async (token) => {
        const [marketData, tradeData] = await Promise.all([
          getTokenMarketData(token.address),
          getTokenTradeData(token.address),
        ]);

        const volumeToMarketcap =
          tradeData.volume_1h_usd / marketData.marketcap;
        const volumeToLiquidity =
          tradeData.volume_1h_usd / marketData.liquidity;

        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          price: marketData.price,
          marketcap: marketData.marketcap,
          volume1h: tradeData.volume_1h_usd,
          volumeToMarketcap,
          volumeToLiquidity,
          priceChange1h: tradeData.price_change_1h_percent,
        };
      })
    );

    // Sort by volumeToMarketcap ratio
    analyses.sort((a, b) => b.volumeToMarketcap - a.volumeToMarketcap);

    const bestAnalysis = analyses[0];
    if (!bestAnalysis) return null;

    const selectedToken = {
      address: bestAnalysis.address,
      symbol: bestAnalysis.symbol,
      name: bestAnalysis.name,
      entryPrice: bestAnalysis.price,
      entryTime: new Date(),
      volumeToMarketcapAtEntry: bestAnalysis.volumeToMarketcap,
      lastAnalyzed: new Date(),
      isActive: true,
    };

    return { analysis: bestAnalysis, selectedToken: selectedToken };
  } catch (error) {
    console.error("Error finding best trading opportunity:", error);
    throw error;
  }
}
