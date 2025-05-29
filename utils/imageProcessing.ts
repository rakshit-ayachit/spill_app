import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import * as FileSystem from 'expo-file-system';
import { CONFIG } from '../config';

// Initialize the Google Generative AI with your API key
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);

interface BillItem {
  id: string;
  description: string;
  price: number;
  isShared?: boolean; // Flag for tax items that will be shared equally
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
 * and extracts items with their prices
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
      
      Please carefully analyze the image and extract:
      1. All individual line items with their prices
      2. Any tax-related items (sales tax, GST, HST, VAT, service charge, etc.)
      
      Pay special attention to:
      - Item names/descriptions
      - Their corresponding prices
      - All tax-related charges
      
      Format your response as a valid JSON array of objects with the following structure:
      [
        {
          "description": "Item name",
          "price": 10.99,
          "isTax": false
        },
        {
          "description": "Tax",
          "price": 1.50,
          "isTax": true
        }
      ]
      
      For regular items, set "isTax" to false.
      For any tax or service charge items, set "isTax" to true.
      
      Only include the JSON array in your response, nothing else. Make sure the JSON is valid and properly formatted.
      If you can't see any items clearly, return an empty array [].
    `;

    // Generate content
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    // Parse the JSON response
    let parsedItems: { description: string; price: number; isTax?: boolean }[];
    try {
      // Try to parse the direct response
      parsedItems = JSON.parse(text);
    } catch (e) {
      // If direct parsing fails, try to extract JSON from the text
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedItems = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse model response as JSON');
      }
    }
    
    // Map the parsed items to our BillItem interface with unique IDs
    const billItems: BillItem[] = parsedItems.map((item, index) => ({
      id: (index + 1).toString(),
      description: item.description,
      price: item.price,
      isShared: item.isTax === true // Mark tax items as shared
    }));

    return { items: billItems };
  } catch (error) {
    console.error('Error processing bill image:', error);
    throw new Error('Failed to process bill image: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
};
