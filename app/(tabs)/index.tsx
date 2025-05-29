import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

// Types
type AppStep = 'upload_participants' | 'assign_items' | 'summary';

interface BillItem {
  id: string;
  description: string;
  price: number;
}

interface Participant {
  id: string;
  name: string;
}

interface ItemAssignments {
  [itemId: string]: string[];
}

interface CostPerParticipant {
  [participantId: string]: number;
}

// Import the bill processing function
import { processBillImage } from '../../utils/imageProcessing';

// Function to extract bill items using Google's Generative AI
const extractBillItems = async (billImage: string): Promise<{ items: BillItem[] }> => {
  try {
    // Process the bill image using Google's Generative AI
    return await processBillImage(billImage);
  } catch (error) {
    console.error('Error in extractBillItems:', error);
    throw error;
  }
};

export default function SplitShareApp() {
  const [appStep, setAppStep] = useState<AppStep>('upload_participants');
  const [billImageUri, setBillImageUri] = useState<string | null>(null);
  
  const [extractedItems, setExtractedItems] = useState<BillItem[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [itemAssignments, setItemAssignments] = useState<ItemAssignments>({});
  
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Sorry, we need camera roll permissions to make this work!');
      }
    })();
  }, []);

  const handleImageUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      });

      if (!result.canceled && result.assets[0]) {
        setBillImageUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const handleCameraCapture = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setBillImageUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to capture image');
    }
  };

  const handleAddParticipant = () => {
    if (newParticipantName.trim() && !participants.find(p => p.name === newParticipantName.trim())) {
      setParticipants([...participants, { 
        id: Date.now().toString(), 
        name: newParticipantName.trim() 
      }]);
      setNewParticipantName('');
    } else if (participants.find(p => p.name === newParticipantName.trim())) {
      Alert.alert('Participant exists', 'This participant name is already added.');
    }
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants(participants.filter(p => p.id !== id));
    // Remove from assignments
    const newAssignments = { ...itemAssignments };
    Object.keys(newAssignments).forEach(itemId => {
      newAssignments[itemId] = newAssignments[itemId].filter(pId => pId !== id);
    });
    setItemAssignments(newAssignments);
  };

  const handleProcessBill = async () => {
    if (!billImageUri) {
      Alert.alert('Error', 'Please upload a bill image.');
      return;
    }
    if (participants.length === 0) {
      Alert.alert('Error', 'Please add at least one participant.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await extractBillItems(billImageUri);
      if (result && result.items) {
        const itemsWithIds = result.items.map(item => ({ 
          ...item, 
          id: item.id || Date.now().toString() 
        }));
        setExtractedItems(itemsWithIds);
        
        // Initialize assignments
        const initialAssignments: ItemAssignments = {};
        itemsWithIds.forEach(item => initialAssignments[item.id] = []);
        setItemAssignments(initialAssignments);
        setAppStep('assign_items');
        Alert.alert('Success', 'Bill items extracted successfully.');
      } else {
        throw new Error('Failed to extract items or no items found.');
      }
    } catch (error) {
      console.error('Error extracting bill items:', error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred during bill processing.';
      
      // Check for API key configuration error
      if (message.includes('API key not configured')) {
        Alert.alert(
          'Configuration Error', 
          'Please set up your Gemini API key in the config file.',
          [
            { 
              text: 'Learn More', 
              onPress: () => {
                // You could add navigation to a help page here
                Alert.alert('API Key Setup', 'Get your API key from Google AI Studio (https://ai.google.dev/) and add it to config/index.ts')
              } 
            },
            { text: 'OK', style: 'cancel' }
          ]
        );
      } else {
        Alert.alert('Error', `Failed to process bill: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleItemAssignmentChange = (itemId: string, participantId: string, checked: boolean) => {
    setItemAssignments(prev => {
      const currentAssignments = prev[itemId] || [];
      if (checked) {
        return { ...prev, [itemId]: [...currentAssignments, participantId] };
      } else {
        return { ...prev, [itemId]: currentAssignments.filter(id => id !== participantId) };
      }
    });
  };

  const totalBillAmount = useMemo(() => {
    return extractedItems.reduce((sum, item) => sum + item.price, 0);
  }, [extractedItems]);

  const costBreakdown = useMemo((): CostPerParticipant => {
    const costs: CostPerParticipant = {};
    participants.forEach(p => costs[p.id] = 0);

    const assignedItemIds = new Set<string>();

    extractedItems.forEach(item => {
      const assignedTo = itemAssignments[item.id] || [];
      if (assignedTo.length > 0) {
        assignedItemIds.add(item.id);
        const costPerParticipant = item.price / assignedTo.length;
        assignedTo.forEach(pId => {
          costs[pId] = (costs[pId] || 0) + costPerParticipant;
        });
      }
    });
    
    const unassignedItems = extractedItems.filter(item => !assignedItemIds.has(item.id));
    if (unassignedItems.length > 0 && participants.length > 0) {
      const costPerSharedItemPortion = unassignedItems.reduce((sum, item) => sum + item.price, 0) / participants.length;
      participants.forEach(p => {
        costs[p.id] = (costs[p.id] || 0) + costPerSharedItemPortion;
      });
    }
    
    return costs;
  }, [extractedItems, participants, itemAssignments]);

  const handleStartNewBill = () => {
    setAppStep('upload_participants');
    setBillImageUri(null);
    setExtractedItems([]);
    setParticipants([]);
    setNewParticipantName('');
    setItemAssignments({});
    setIsLoading(false);
  };

  const renderUploadParticipantsStep = () => (
    <ScrollView style={styles.stepContainer}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bill Image</Text>
        <View style={styles.imageUploadContainer}>
          <TouchableOpacity style={styles.uploadButton} onPress={handleImageUpload}>
            <Ionicons name="cloud-upload-outline" size={24} color="#007AFF" />
            <Text style={styles.uploadButtonText}>Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.uploadButton} onPress={handleCameraCapture}>
            <Ionicons name="camera-outline" size={24} color="#007AFF" />
            <Text style={styles.uploadButtonText}>Take Photo</Text>
          </TouchableOpacity>
        </View>
        {billImageUri && (
          <View style={styles.imagePreview}>
            <Image source={{ uri: billImageUri }} style={styles.previewImage} />
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Participants</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={newParticipantName}
            onChangeText={setNewParticipantName}
            placeholder="Enter participant's name"
            onSubmitEditing={handleAddParticipant}
          />
          <TouchableOpacity 
            style={[styles.addButton, !newParticipantName.trim() && styles.disabledButton]} 
            onPress={handleAddParticipant}
            disabled={!newParticipantName.trim()}
          >
            <Ionicons name="add" size={20} color="white" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        
        {participants.length > 0 && (
          <ScrollView style={styles.participantsList}>
            {participants.map(p => (
              <View key={p.id} style={styles.participantItem}>
                <Text style={styles.participantName}>{p.name}</Text>
                <TouchableOpacity onPress={() => handleRemoveParticipant(p.id)}>
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </ScrollView>
  );

  const renderAssignItemsStep = () => (
    <ScrollView style={styles.stepContainer}>
      {extractedItems.map(item => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemDescription}>{item.description}</Text>
            <Text style={styles.itemPrice}>₹{item.price.toFixed(2)}</Text>
          </View>
          <Text style={styles.sharedByLabel}>Shared by:</Text>
          <View style={styles.participantGrid}>
            {participants.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.participantCheckbox,
                  itemAssignments[item.id]?.includes(p.id) && styles.participantCheckboxSelected
                ]}
                onPress={() => handleItemAssignmentChange(
                  item.id, 
                  p.id, 
                  !itemAssignments[item.id]?.includes(p.id)
                )}
              >
                <Ionicons 
                  name={itemAssignments[item.id]?.includes(p.id) ? "checkmark-circle" : "ellipse-outline"} 
                  size={20} 
                  color={itemAssignments[item.id]?.includes(p.id) ? "#007AFF" : "#666"} 
                />
                <Text style={styles.participantCheckboxText}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );

  const renderSummaryStep = () => (
    <ScrollView style={styles.stepContainer}>
      <View style={styles.totalCard}>
        <View style={styles.totalHeader}>
          <Ionicons name="checkmark-circle" size={24} color="#34C759" />
          <Text style={styles.totalTitle}>Bill Total</Text>
        </View>
        <Text style={styles.totalAmount}>₹{totalBillAmount.toFixed(2)}</Text>
      </View>

      <View style={styles.summarySection}>
        <View style={styles.summaryHeader}>
          <Ionicons name="people-outline" size={24} color="#007AFF" />
          <Text style={styles.summaryTitle}>Individual Amounts:</Text>
        </View>
        {participants.map(p => (
          <View key={p.id} style={styles.summaryCard}>
            <Text style={styles.summaryName}>{p.name}</Text>
            <Text style={styles.summaryAmount}>₹{(costBreakdown[p.id] || 0).toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  const getStepTitle = () => {
    switch (appStep) {
      case 'upload_participants': return 'Upload Bill & Add Participants';
      case 'assign_items': return 'Assign Bill Items';
      case 'summary': return 'Cost Summary';
    }
  };

  const getStepDescription = () => {
    switch (appStep) {
      case 'upload_participants': return 'Upload your bill image and add the names of everyone sharing.';
      case 'assign_items': return 'Select who consumed each item. Unassigned items will be split equally.';
      case 'summary': return "Here's the breakdown of who owes what.";
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>Spill</Text>
      </View>

      {/* Main Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{getStepTitle()}</Text>
          <Text style={styles.cardDescription}>{getStepDescription()}</Text>
        </View>

        {/* Step Content */}
        {appStep === 'upload_participants' && renderUploadParticipantsStep()}
        {appStep === 'assign_items' && renderAssignItemsStep()}
        {appStep === 'summary' && renderSummaryStep()}

        {/* Footer Buttons */}
        <View style={styles.footer}>
          {appStep === 'upload_participants' && (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isLoading || !billImageUri || participants.length === 0) && styles.disabledButton
              ]}
              onPress={handleProcessBill}
              disabled={isLoading || !billImageUri || participants.length === 0}
            >
              {isLoading ? (
                <>
                  <Text style={styles.primaryButtonText}>Processing...</Text>
                  <Text style={styles.processingSubtext}>Analyzing bill with AI</Text>
                </>
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Process Bill & Assign Items</Text>
                  <Ionicons name="arrow-forward" size={20} color="white" />
                </>
              )}
            </TouchableOpacity>
          )}

          {appStep === 'assign_items' && (
            <View style={styles.buttonRow}>
              <TouchableOpacity 
                style={styles.secondaryButton} 
                onPress={() => setAppStep('upload_participants')}
              >
                <Ionicons name="arrow-back" size={20} color="#007AFF" />
                <Text style={styles.secondaryButtonText}>Back to Upload</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.primaryButton, 
                  styles.flexButton,
                  (extractedItems.length === 0 || participants.length === 0) && styles.disabledButton
                ]} 
                onPress={() => setAppStep('summary')}
                disabled={extractedItems.length === 0 || participants.length === 0}
              >
                <Text style={styles.primaryButtonText}>Show Summary</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          )}

          {appStep === 'summary' && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartNewBill}>
              <Ionicons name="add-circle-outline" size={20} color="white" />
              <Text style={styles.primaryButtonText}>Start New Bill</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Footer */}
      <Text style={styles.appFooter}>Spill © {new Date().getFullYear()}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: 'white',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  card: {
    flex: 1,
    margin: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  stepContainer: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  imageUploadContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    marginLeft: 8,
    color: '#007AFF',
    fontWeight: '500',
  },
  imagePreview: {
    alignItems: 'center',
    marginTop: 16,
  },
  previewImage: {
    width: 200,
    height: 240,
    borderRadius: 8,
    resizeMode: 'contain',
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  addButtonText: {
    color: 'white',
    fontWeight: '600',
    marginLeft: 4,
  },
  disabledButton: {
    opacity: 0.5,
  },
  participantsList: {
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
  },
  participantItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'white',
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 6,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  itemDescription: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  sharedByLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  participantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minWidth: '45%',
  },
  participantCheckboxSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f8ff',
  },
  participantCheckboxText: {
    marginLeft: 8,
    fontSize: 12,
    flex: 1,
  },
  totalCard: {
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#34C759',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  totalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    color: '#333',
  },
  totalAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#34C759',
  },
  summarySection: {
    marginBottom: 24,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    color: '#007AFF',
  },
  summaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryName: {
    fontSize: 16,
    fontWeight: '500',
  },
  summaryAmount: {
    fontSize: 20,
    fontWeight: '600',
    color: '#007AFF',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    gap: 8,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  processingSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontWeight: '400',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
  appFooter: {
    textAlign: 'center',
    padding: 16,
    fontSize: 12,
    color: '#666',
  },
});