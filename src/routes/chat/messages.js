const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authenticateUser = require('../../middlewares/authMiddleware');
const { generalLimiter, sellerStoreLimiter } = require('../../middlewares/limit');
const { supabase, supabaseAdmin } = require('../../db/supabase');
const { encryptFields, decryptFields } = require('../../utils/encryption');

const MESSAGE_ENCRYPTED_FIELDS = ['message_text'];
const CONVERSATION_ENCRYPTED_FIELDS = ['last_message_preview'];
const PREVIEW_MAX_LENGTH = 100;

const decryptMessage = (message) => decryptFields(message, MESSAGE_ENCRYPTED_FIELDS);
const decryptConversation = (conversation) => decryptFields(conversation, CONVERSATION_ENCRYPTED_FIELDS);

const buildEncryptedPreview = (messageText) => {
    const preview = String(messageText || '').slice(0, PREVIEW_MAX_LENGTH);
    return encryptFields({ last_message_preview: preview }, CONVERSATION_ENCRYPTED_FIELDS).last_message_preview;
};

const getSellerByUserId = async (userId) => {
    const { data: seller, error } = await supabase
        .from('sellers')
        .select('id, user_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw new Error('Error verifying seller');
    }

    return seller;
};

router.get('/seller/conversations', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const seller = await getSellerByUserId(req.user.id);
        if (!seller) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const { data: conversations, error } = await supabaseAdmin
            .from('conversations')
            .select(`
                *,
                customer:customer_id (email, first_name, last_name, user_id),
                product:product_id (name)
            `)
            .eq('seller_id', req.user.id)
            .order('last_message_at', { ascending: false });

        if (error) {
            console.error('Error fetching seller conversations:', error);
            return res.status(500).json({ message: 'Error fetching conversations' });
        }

        const data = (conversations || []).map((conversation) => {
            const decryptedConversation = decryptConversation(conversation);
            const fullName = decryptedConversation.customer
                ? `${decryptedConversation.customer.first_name || ''} ${decryptedConversation.customer.last_name || ''}`.trim()
                : 'Client';

            return {
                ...decryptedConversation,
                customer_name: fullName || 'Client',
                customer_initials: (fullName || 'C').charAt(0).toUpperCase(),
            };
        });

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Get seller conversations error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/seller/conversations/:conversationId/messages', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;

        const { data: conversation, error: conversationError } = await supabaseAdmin
            .from('conversations')
            .select('id, seller_id')
            .eq('id', conversationId)
            .maybeSingle();

        if (conversationError) {
            console.error('Error fetching conversation:', conversationError);
            return res.status(500).json({ message: 'Error fetching conversation' });
        }

        if (!conversation || conversation.seller_id !== req.user.id) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const { data: messages, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching messages:', error);
            return res.status(500).json({ message: 'Error fetching messages' });
        }

        const data = (messages || []).map(decryptMessage);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Get seller messages error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/seller/conversations/:conversationId/messages', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messageText = String(req.body?.message_text || '').trim();

        if (!messageText) {
            return res.status(400).json({ message: 'Message text is required' });
        }

        const { data: conversation, error: conversationError } = await supabaseAdmin
            .from('conversations')
            .select('id, seller_id, customer_id')
            .eq('id', conversationId)
            .maybeSingle();

        if (conversationError) {
            console.error('Error fetching conversation:', conversationError);
            return res.status(500).json({ message: 'Error fetching conversation' });
        }

        if (!conversation || conversation.seller_id !== req.user.id) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const encryptedPayload = encryptFields({
            conversation_id: conversationId,
            sender_id: req.user.id,
            sender_type: 'seller',
            receiver_id: conversation.customer_id,
            receiver_type: 'customer',
            message_text: messageText,
        }, MESSAGE_ENCRYPTED_FIELDS);

        const { data: insertedMessage, error: insertError } = await supabaseAdmin
            .from('messages')
            .insert(encryptedPayload)
            .select('*')
            .single();

        if (insertError) {
            console.error('Error inserting seller message:', insertError);
            return res.status(500).json({ message: 'Error sending message' });
        }

        const { error: conversationUpdateError } = await supabaseAdmin
            .from('conversations')
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: buildEncryptedPreview(messageText),
                updated_at: new Date().toISOString(),
            })
            .eq('id', conversationId);

        if (conversationUpdateError) {
            console.error('Error updating conversation preview:', conversationUpdateError);
        }

        return res.status(201).json({ success: true, data: decryptMessage(insertedMessage) });
    } catch (error) {
        console.error('Send seller message error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.put('/seller/conversations/:conversationId/mark-read', authenticateUser, sellerStoreLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;

        const { error } = await supabaseAdmin.rpc('mark_messages_as_read', {
            p_conversation_id: conversationId,
            p_user_id: req.user.id,
            p_user_type: 'seller',
        });

        if (error) {
            console.error('Error marking seller messages as read:', error);
            return res.status(500).json({ message: 'Error marking messages as read' });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Mark seller messages read error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/widget/conversations/:conversationId/messages', generalLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const guestCustomerId = req.query?.guest_customer_id ? String(req.query.guest_customer_id) : null;
        const customerUserId = req.query?.customer_user_id ? String(req.query.customer_user_id) : null;

        if (!guestCustomerId && !customerUserId) {
            return res.status(400).json({ message: 'guest_customer_id or customer_user_id is required' });
        }

        const { data: conversation, error: conversationError } = await supabaseAdmin
            .from('conversations')
            .select('id, customer_id, customer:customer_id (user_id)')
            .eq('id', conversationId)
            .maybeSingle();

        if (conversationError || !conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const isAllowed = (
            (customerUserId && conversation.customer?.user_id === customerUserId)
            || (guestCustomerId && conversation.customer_id === guestCustomerId)
        );

        if (!isAllowed) {
            return res.status(403).json({ message: 'Forbidden conversation access' });
        }

        const { data: messages, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching widget messages:', error);
            return res.status(500).json({ message: 'Error fetching messages' });
        }

        const data = (messages || []).map(decryptMessage);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Get widget messages error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/widget/messages', generalLimiter, async (req, res) => {
    try {
        const messageText = String(req.body?.message_text || '').trim();
        const sellerShopId = String(req.body?.seller_shop_id || '').trim();
        const productId = req.body?.product_id || null;
        const customerUserId = req.body?.customer_user_id || null;
        const customerEmail = req.body?.customer_email || '';
        const guestCustomerId = req.body?.guest_customer_id || null;
        let conversationId = req.body?.conversation_id || null;

        if (!messageText || !sellerShopId) {
            return res.status(400).json({ message: 'seller_shop_id and message_text are required' });
        }

        const { data: shopData, error: shopError } = await supabaseAdmin
            .from('shops')
            .select('id, seller_id')
            .eq('id', sellerShopId)
            .maybeSingle();

        if (shopError || !shopData?.seller_id) {
            return res.status(404).json({ message: 'Shop not found' });
        }

        const { data: sellerData, error: sellerError } = await supabaseAdmin
            .from('sellers')
            .select('id, user_id')
            .eq('id', shopData.seller_id)
            .maybeSingle();

        if (sellerError || !sellerData?.user_id) {
            return res.status(404).json({ message: 'Seller not found' });
        }

        const sellerUserId = sellerData.user_id;

        let customerId = null;
        if (guestCustomerId) {
            const { data: guestCustomer } = await supabaseAdmin
                .from('customers')
                .select('id')
                .eq('id', guestCustomerId)
                .maybeSingle();
            customerId = guestCustomer?.id || null;
        }

        if (!customerId && customerUserId) {
            const { data: existingCustomer } = await supabaseAdmin
                .from('customers')
                .select('id')
                .eq('user_id', customerUserId)
                .maybeSingle();

            customerId = existingCustomer?.id || null;

            if (!customerId) {
                const { data: createdCustomer, error: createCustomerError } = await supabaseAdmin
                    .from('customers')
                    .insert({
                        user_id: customerUserId,
                        email: customerEmail || '',
                        first_name: 'Customer',
                        last_name: String(customerUserId).slice(0, 8),
                    })
                    .select('id')
                    .single();

                if (createCustomerError || !createdCustomer) {
                    console.error('Error creating authenticated customer:', createCustomerError);
                    return res.status(500).json({ message: 'Error resolving customer' });
                }

                customerId = createdCustomer.id;
            }
        }

        if (!customerId) {
            const { data: createdGuestCustomer, error: createGuestError } = await supabaseAdmin
                .from('customers')
                .insert({
                    user_id: null,
                    email: customerEmail || '',
                    first_name: 'Customer',
                    last_name: crypto.randomUUID().slice(0, 8),
                })
                .select('id')
                .single();

            if (createGuestError || !createdGuestCustomer) {
                console.error('Error creating guest customer:', createGuestError);
                return res.status(500).json({ message: 'Error resolving customer' });
            }

            customerId = createdGuestCustomer.id;
        }

        if (!conversationId) {
            const { data: existingConversation } = await supabaseAdmin
                .from('conversations')
                .select('id')
                .eq('customer_id', customerId)
                .eq('seller_id', sellerUserId)
                .eq('shop_id', sellerShopId)
                .maybeSingle();

            if (existingConversation?.id) {
                conversationId = existingConversation.id;
            } else {
                const encryptedConversationPayload = encryptFields({
                    customer_id: customerId,
                    seller_id: sellerUserId,
                    shop_id: sellerShopId,
                    product_id: productId || null,
                    last_message_at: new Date().toISOString(),
                    last_message_preview: String(messageText).slice(0, PREVIEW_MAX_LENGTH),
                }, CONVERSATION_ENCRYPTED_FIELDS);

                const { data: newConversation, error: newConversationError } = await supabaseAdmin
                    .from('conversations')
                    .insert(encryptedConversationPayload)
                    .select('id')
                    .single();

                if (newConversationError || !newConversation) {
                    console.error('Error creating conversation:', newConversationError);
                    return res.status(500).json({ message: 'Error creating conversation' });
                }

                conversationId = newConversation.id;
            }
        } else {
            const { data: existingConversation, error: existingConversationError } = await supabaseAdmin
                .from('conversations')
                .select('id, customer_id, seller_id, shop_id')
                .eq('id', conversationId)
                .maybeSingle();

            if (
                existingConversationError
                || !existingConversation
                || existingConversation.customer_id !== customerId
                || existingConversation.seller_id !== sellerUserId
                || existingConversation.shop_id !== sellerShopId
            ) {
                return res.status(403).json({ message: 'Conversation does not belong to this customer/shop context' });
            }
        }

        const encryptedMessagePayload = encryptFields({
            conversation_id: conversationId,
            sender_id: customerUserId || customerId,
            sender_type: 'customer',
            receiver_id: sellerUserId,
            receiver_type: 'seller',
            message_text: messageText,
        }, MESSAGE_ENCRYPTED_FIELDS);

        const { data: insertedMessage, error: messageInsertError } = await supabaseAdmin
            .from('messages')
            .insert(encryptedMessagePayload)
            .select('*')
            .single();

        if (messageInsertError) {
            console.error('Error inserting widget message:', messageInsertError);
            return res.status(500).json({ message: 'Error sending message' });
        }

        const { error: conversationUpdateError } = await supabaseAdmin
            .from('conversations')
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: buildEncryptedPreview(messageText),
                updated_at: new Date().toISOString(),
            })
            .eq('id', conversationId);

        if (conversationUpdateError) {
            console.error('Error updating conversation preview for widget:', conversationUpdateError);
        }

        return res.status(201).json({
            success: true,
            conversation_id: conversationId,
            customer_id: customerId,
            data: decryptMessage(insertedMessage),
        });
    } catch (error) {
        console.error('Send widget message error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
