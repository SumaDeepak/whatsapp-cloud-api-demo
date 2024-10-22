// Import necessary packages
require('dotenv').config();
const axios = require('axios');
const bodyParser = require('body-parser');
const express = require('express');
const mongoose = require('mongoose');

// Create an Express app
const app = express();
app.use(bodyParser.json());

// Connect to MongoDB using MONGODB_URI from environment variables
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/OrderInformation';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('Error connecting to MongoDB:', err));

// Middleware
app.use(express.json());

// Define a simple route
app.get('/', (req, res) => {
  res.send('Hello World!');
});


app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  
    // Parse params from the request
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
  
    // Check if a token and mode were sent
    if (mode && token) {
      // Check the mode and token sent is correct
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        // Respond with the challenge token from the request
        console.log('Webhook Verified');
        res.status(200).send(challenge);
      } else {
        // Respond with '403 Forbidden' if verify tokens do not match
        res.sendStatus(403);
      }
    }
  });
  

// Load environment variables
const token = process.env.WHATSAPP_TOKEN;
const phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID;
const commerce_api_url = process.env.COMMERCE_API_URL;
const catalog_id = process.env.COMMERCE_CATALOG_ID;

// Import Models
const Customer = require('./models/customerModel');
const Order = require('./models/orderModel');

// URL for sending WhatsApp messages via Cloud API
const whatsappApiUrl = `https://graph.facebook.com/v17.0/${phone_number_id}/messages`;

// Function to send a WhatsApp text message
async function sendWhatsAppMessage(recipient, message) {
  try {
    const response = await axios.post(
      whatsappApiUrl,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Message sent:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// Function to send a welcome message with shopping prompt
async function sendWelcomeMessage(recipient) {
  const welcomeMessage = 'Welcome! Do you want to shop with us?';
  const replyButtons = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'text',
        text: 'Welcome to Our Store!'
      },
      body: {
        text: welcomeMessage
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'button_yes',
              title: 'Yes'
            }
          },
          {
            type: 'reply',
            reply: {
              id: 'button_no',
              title: 'No'
            }
          }
        ]
      }
    }
  };

  await sendWhatsAppMessage(recipient, replyButtons);
}

// Function to send an interactive product message to WhatsApp
async function sendInteractiveProductMessage(recipient) {
  try {
    // Fetch the product catalog from Commerce Manager
    const response = await axios.get(commerce_api_url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const products = response.data.data;
    if (!products || products.length === 0) {
      console.log('No products available.');
      return;
    }

    // Create sections for the interactive product message
    const sections = products.map((product) => ({
      title: product.name,
      product_items: [
        {
          product_retailer_id: product.retailer_id,
        },
      ],
    }));

    // Send the interactive product message
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'product_list',
        header: {
          type: 'text',
          text: 'Check out our product catalog!',
        },
        body: {
          text: 'Browse our products and add them to your cart!',
        },
        footer: {
          text: 'Tap to view more!',
        },
        action: {
          catalog_id: catalog_id,
          sections: sections,
        },
      },
    };

    const interactiveResponse = await axios.post(
      whatsappApiUrl,
      messagePayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Interactive product message sent successfully:', interactiveResponse.data);
  } catch (error) {
    console.error('Error sending interactive product message:', error.response ? error.response.data : error.message);
  }
}

// Handle incoming webhook messages from WhatsApp
app.post('/webhook', async (req, res) => {
  const entry = req.body.entry;

  if (entry && entry.length > 0) {
    const changes = entry[0].changes;
    const value = changes[0].value;
    const messages = value.messages;

    if (messages && messages.length > 0) {
      const from = messages[0].from; // The customer's WhatsApp number
      const messageBody = messages[0].text ? messages[0].text.body : null; // The message text
      const buttonId = messages[0].interactive ? messages[0].interactive.button_id : null; // Button clicked

      console.log('Received message from:', from, 'Message:', messageBody);

      // Find or create customer based on WhatsApp number
      const customer = await findOrCreateCustomer(from);

      // Conversation flow based on customer messages
      if (messageBody && (messageBody.toLowerCase() === 'hi' || messageBody.toLowerCase() === 'hello')) {
        // Send welcome message
        await sendWelcomeMessage(from);
      } else if (buttonId === 'button_yes') {
        // User wants to shop
        await sendInteractiveProductMessage(from);
      } else if (buttonId === 'button_no') {
        // User does not want to shop
        await sendWhatsAppMessage(from, 'Okay! Let us know if you need anything else.');
      } else if (messageBody && messageBody.startsWith('Order:')) {
        // Extract order details from message (e.g., 'Order: Sony WH-1000XM4, qty: 1')
        const orderDetails = extractOrderDetails(messageBody);
        customer.currentOrder = orderDetails; // Store temporary order details in the customer object

        // Ask for delivery address
        await sendWhatsAppMessage(from, 'Please provide your delivery address:');
      } else if (customer.currentOrder && !customer.address) {
        // Assume the current message is the delivery address
        customer.address = messageBody;

        // Save the order
        const order = await saveOrder(customer._id, {
          items: customer.currentOrder.items,
          total_price: customer.currentOrder.total_price,
          address: customer.address,
        });

        // Confirm order to the customer
        await sendWhatsAppMessage(from, `Thank you for your order! Your total is $${order.total_price}. We will deliver to ${customer.address}.`);
        console.log('Order saved:', order);
      } else {
        await sendWhatsAppMessage(from, 'Sorry, I didn\'t understand that. Please reply with "Hi" to start shopping.');
      }
    }
  }

  res.sendStatus(200);
});

// Utility function to extract order details from the message text
function extractOrderDetails(messageBody) {
  // Example format: "Order: Sony WH-1000XM4, qty: 1"
  const parts = messageBody.split(',');
  const product_name = parts[0].split('Order: ')[1];
  const quantity = parseInt(parts[1].split('qty: ')[1]);

  // Example product price lookup (you can replace this with a real lookup)
  const price = 300; // Assume each item costs $300 for simplicity

  return {
    items: [{ product_name, quantity }],
    total_price: price * quantity,
  };
}

// Utility function to find or create a customer in the database
async function findOrCreateCustomer(whatsappNumber) {
  let customer = await Customer.findOne({ whatsappNumber });

  if (!customer) {
    customer = new Customer({ whatsappNumber });
    await customer.save();
    console.log('New customer created:', customer);
  }

  return customer;
}

// Utility function to save an order
async function saveOrder(customerId, orderDetails) {
  const order = new Order({
    customer: customerId,
    items: orderDetails.items,
    total_price: orderDetails.total_price,
    address: orderDetails.address,
  });

  return await order.save();
}

// Handle EADDRINUSE error by retrying on a different port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Trying a new port...`);
    app.listen(0, () => {
      console.log(`Server started on a random available port.`);
    });
  } else {
    console.error('Server error:', err);
  }
});
