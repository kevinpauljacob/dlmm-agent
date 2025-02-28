import axios from "axios";
import {
  type TrendingToken,
  type TokenAnalysis,
  type SelectedToken,
  type DexScreenerPairData,
  type DexScreenerTokenBoost,
} from "../types/market";
import connectToDatabase from "../utils/database";
import { config } from "dotenv";
config();

const BASE_URL = "https://api.dexscreener.com";

const headers = {
  accept: "application/json",
};

export async function getTrendingTokens(): Promise<TrendingToken[]> {
  try {
    const response = await axios.get<DexScreenerTokenBoost[]>(
      `${BASE_URL}/token-boosts/top/v1`,
      { headers }
    );

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error("Invalid response from DexScreener token boosts API");
    }

    return response.data
      .filter((item) => item.chainId === "solana")
      .map((item, index) => ({
        address: item.tokenAddress,
        rank: index,
      }));
  } catch (error) {
    console.error("Error fetching trending tokens:", error);
    throw error;
  }
}

export async function getTokenData(address: string) {
  console.log("Fetching data from DexScreener for", address);
  try {
    const response = await axios.get(
      `${BASE_URL}/tokens/v1/solana/${address}`,
      { headers }
    );

    if (
      !response.data ||
      !Array.isArray(response.data) ||
      response.data.length === 0
    ) {
      throw new Error(`No data found for token ${address}`);
    }

    return response.data[0];
  } catch (error) {
    console.error(
      `Error fetching data from DexScreener for ${address}:`,
      error
    );
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
    const trendingTokens = await getTrendingTokens();

    // Analyze each token
    const analyses = await Promise.all(
      trendingTokens.map(async (token) => {
        const data: DexScreenerPairData = await getTokenData(token.address);

        const volumeToMarketCap = data.volume.h1 / data.marketCap;
        const volumeToLiquidity = data.volume.h1 / data.liquidity.base;

        return {
          address: data.baseToken.address,
          symbol: data.baseToken.symbol,
          name: data.baseToken.name,
          price: parseFloat(data.priceNative),
          marketCap: data.marketCap,
          volume1h: data.volume.h1,
          volumeToMarketCap,
          volumeToLiquidity,
          priceChange1h: data.priceChange.h1,
        };
      })
    );

    // Sort by volumeToMarketcap ratio
    analyses.sort((a, b) => b.volumeToMarketCap - a.volumeToMarketCap);

    const bestAnalysis = analyses[0];
    if (!bestAnalysis) return null;

    const selectedToken = {
      address: bestAnalysis.address,
      symbol: bestAnalysis.symbol,
      name: bestAnalysis.name,
      entryPrice: bestAnalysis.price,
      entryTime: new Date(),
      volumeToMarketCapAtEntry: bestAnalysis.volumeToMarketCap,
      lastAnalyzed: new Date(),
      isActive: true,
    };

    return { analysis: bestAnalysis, selectedToken: selectedToken };
  } catch (error) {
    console.error("Error finding best trading opportunity:", error);
    throw error;
  }
}
