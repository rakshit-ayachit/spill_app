import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import * as FileSystem from 'expo-file-system';
import { CONFIG } from '../config';

// Initialize the Google Generative AI with your API key
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);

interface BillItem {
  id: string;
  description: string;
  price: number;
}

/**
 * Converts a local file URI to a base64 string
 */
const getBase64FromUri = async (uri: string): Promise<string> => {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (error) {
    console.error('Error reading file as base64:', error);
    throw new Error('Failed to read image file');
  }
};

/**
 * Extracts the MIME type from a URI
 */
const getMimeTypeFromUri = (uri: string): string => {
  // Default to image/jpeg if can't determine
  if (!uri.includes('.')) return 'image/jpeg';
  
  const extension = uri.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png': return 'image/png';
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default: return 'image/jpeg';
  }
};

/**
 * Processes a bill image using Google's Generative AI (Gemini)
 * and extracts items with their prices, including CGST and SGST,
 * splitting tax equally across items.
 */
export const processBillImage = async (
  imageUri: string
): Promise<{ items: BillItem[] }> => {
  try {
    // Check if API key is configured
    if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
      throw new Error('Gemini API key not configured. Please add your API key in the config file.');
    }

    // Get the base64 data and MIME type
    const base64Data = await getBase64FromUri(imageUri);
    const mimeType = getMimeTypeFromUri(imageUri);

    // Configure the Gemini model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    });

    // Prepare the image data
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    };

    // Construct the prompt for the model
    const prompt = `
      This is an image of a bill or receipt from a restaurant, store, or service provider.
      
      Please carefully analyze the image and extract the individual line items along with their prices.
      Pay special attention to:
      - Item names/descriptions
      - Their corresponding prices
      - Ignore tax, tip, or total sections except for CGST and SGST.
      
      Also extract the CGST and SGST amounts separately.
      
      For each item, provide:
      1. The item description (exactly as written)
      2. The price (as a number, without currency symbols)
      
      Provide CGST and SGST as separate fields (numbers).
      
      Format your response as a JSON object with the following structure:
      {
        "items": [
          {
            "description": "Item name",
            "price": 10.99
          }
        ],
        "cgst": 1.00,
        "sgst": 1.00
      }
      
      Only include the JSON object in your response, nothing else. Make sure the JSON is valid and properly formatted.
      If you can't see any items or taxes clearly, return empty array for items and zero for cgst and sgst, e.g.:
      {
        "items": [],
        "cgst": 0,
        "sgst": 0
      }
    `;

    // Generate content from model
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    // Parse JSON response
    let parsedResponse: { items: { description: string; price: number }[]; cgst: number; sgst: number };
    try {
      parsedResponse = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse model response as JSON');
      }
    }

    // Defensive defaults if missing
    const items = parsedResponse.items || [];
    const cgst = parsedResponse.cgst || 0;
    const sgst = parsedResponse.sgst || 0;

    // Split total tax equally across items
    const totalTaxPerItem = items.length > 0 ? (cgst + sgst) / items.length : 0;

    // Map to BillItem with unique IDs and adjusted prices
    const billItems: BillItem[] = items.map((item, index) => ({
      id: (index + 1).toString(),
      description: item.description,
      price: +(item.price + totalTaxPerItem).toFixed(2), // round to 2 decimals
    }));

    return { items: billItems };
  } catch (error) {
    console.error('Error processing bill image:', error);
    throw new Error('Failed to process bill image: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
};
