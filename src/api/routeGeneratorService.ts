import { generateRoutes } from "../engine/generateRoute";
import { OpenRouteServiceProvider } from "../engine/providers/openRouteService";
import { GenerateRouteInput } from "../types";

export async function generateTrainingRoutes(input: GenerateRouteInput) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY ?? "";
  const provider = new OpenRouteServiceProvider(apiKey);
  return generateRoutes(provider, input);
}
