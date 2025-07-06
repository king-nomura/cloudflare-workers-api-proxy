// Cloudflare Workers APIプロキシ実装

export default {
  async fetch(request, env, ctx) {
    // CORS設定
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // プリフライトリクエストの処理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    try {
      // リクエストのバリデーション
      const url = new URL(request.url);
      const path = url.pathname;

      // APIエンドポイントのルーティング
      if (path === '/api/external-service') {
        return await handleExternalApiRequest(request, env, corsHeaders);
      }

      if (path === '/api/token') {
        return await handleTokenRequest(request, env, corsHeaders);
      }

      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders 
      });

    } catch (error) {
      console.error('Worker Error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }
  },
};

// 匿名トークン発行の処理
async function handleTokenRequest(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }

  try {
    // 匿名ユーザーIDの生成
    const anonymousUserId = await generateAnonymousUserId();
    
    // トークンの生成
    const token = await generateAnonymousToken(anonymousUserId, env);
    
    // 使用統計の初期化
    await initializeUserStats(anonymousUserId, env);

    return new Response(
      JSON.stringify({ 
        token,
        userId: anonymousUserId,
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30日後
        rateLimit: {
          maxRequests: 100,
          windowMs: 60 * 60 * 1000 // 1時間
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );

  } catch (error) {
    console.error('Token generation error:', error);
    return new Response(
      JSON.stringify({ error: 'Token generation failed' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
}
async function handleExternalApiRequest(request, env, corsHeaders) {
  // POSTリクエストのみ受け付け
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }

  // ユーザー認証の確認
  const authResult = await authenticateUser(request, env);
  if (!authResult.success) {
    return new Response(
      JSON.stringify({ error: authResult.error }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }

  // レート制限の確認
  const rateLimitResult = await checkRateLimit(authResult.userId, env);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({ 
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter 
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': rateLimitResult.retryAfter.toString(),
          ...corsHeaders,
        },
      }
    );
  }

  // リクエストボディの取得
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }

  // 外部APIの呼び出し
  try {
    const externalResponse = await fetch(env.EXTERNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.EXTERNAL_API_KEY}`,
        'User-Agent': 'CloudflareWorkers/1.0',
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await externalResponse.json();

    // レスポンスの加工（必要に応じて）
    const processedData = await processApiResponse(responseData, authResult.userId);

    return new Response(
      JSON.stringify(processedData),
      {
        status: externalResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );

  } catch (error) {
    console.error('External API Error:', error);
    return new Response(
      JSON.stringify({ error: 'External service unavailable' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
}

// ユーザー認証の確認（匿名トークン用）
async function authenticateUser(request, env) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing or invalid authorization header' };
  }

  const token = authHeader.substring(7);
  
  try {
    // 匿名トークンの検証
    const payload = await verifyAnonymousToken(token, env);
    
    return { 
      success: true, 
      userId: payload.userId,
      isAnonymous: true,
      issuedAt: payload.iat,
      expiresAt: payload.exp
    };
  } catch (error) {
    return { success: false, error: 'Invalid or expired token' };
  }
}

// 匿名ユーザーID生成
async function generateAnonymousUserId() {
  const timestamp = Date.now().toString();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `anon_${timestamp}_${randomHex}`;
}

// 匿名トークンの生成
async function generateAnonymousToken(userId, env) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (30 * 24 * 60 * 60); // 30日後
  
  const payload = {
    userId,
    iat: now,
    exp: exp,
    type: 'anonymous'
  };

  return await signJWT(payload, env.JWT_SECRET);
}

// 匿名トークンの検証
async function verifyAnonymousToken(token, secret) {
  try {
    const payload = await verifyJWT(token, secret);
    
    // 匿名トークンの追加チェック
    if (payload.type !== 'anonymous') {
      throw new Error('Invalid token type');
    }
    
    return payload;
  } catch (error) {
    throw new Error('Invalid anonymous token');
  }
}

// ユーザー統計の初期化
async function initializeUserStats(userId, env) {
  try {
    const statsKey = `user_stats:${userId}`;
    const stats = {
      createdAt: Date.now(),
      totalRequests: 0,
      lastRequestAt: null,
      dailyRequests: {}
    };
    
    await env.USER_STATS_KV.put(statsKey, JSON.stringify(stats));
  } catch (error) {
    console.error('Failed to initialize user stats:', error);
  }
}

// レート制限の確認（統計情報も更新）
async function checkRateLimit(userId, env) {
  const rateLimitKey = `rate_limit:${userId}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1時間
  const maxRequests = 100;

  try {
    // レート制限チェック
    const rateData = await env.RATE_LIMIT_KV.get(rateLimitKey);
    
    let requests = [];
    if (rateData) {
      requests = JSON.parse(rateData);
    }

    // 古いリクエストを削除
    requests = requests.filter(timestamp => now - timestamp < windowMs);

    // 制限チェック
    if (requests.length >= maxRequests) {
      const oldestRequest = Math.min(...requests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);
      
      return { 
        allowed: false, 
        retryAfter: retryAfter 
      };
    }

    // 新しいリクエストを追加
    requests.push(now);
    
    // KVに保存（TTLを設定）
    await env.RATE_LIMIT_KV.put(
      rateLimitKey, 
      JSON.stringify(requests),
      { expirationTtl: Math.ceil(windowMs / 1000) }
    );

    // ユーザー統計を更新
    await updateUserStats(userId, env);

    return { allowed: true };

  } catch (error) {
    console.error('Rate limit check failed:', error);
    // レート制限の確認に失敗した場合は通す
    return { allowed: true };
  }
}

// ユーザー統計の更新
async function updateUserStats(userId, env) {
  try {
    const statsKey = `user_stats:${userId}`;
    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];
    
    const existingStats = await env.USER_STATS_KV.get(statsKey);
    let stats = existingStats ? JSON.parse(existingStats) : {
      createdAt: now,
      totalRequests: 0,
      lastRequestAt: null,
      dailyRequests: {}
    };
    
    stats.totalRequests++;
    stats.lastRequestAt = now;
    stats.dailyRequests[today] = (stats.dailyRequests[today] || 0) + 1;
    
    // 古い日次データを削除（30日分のみ保持）
    const cutoffDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    Object.keys(stats.dailyRequests).forEach(date => {
      if (new Date(date) < cutoffDate) {
        delete stats.dailyRequests[date];
      }
    });
    
    await env.USER_STATS_KV.put(statsKey, JSON.stringify(stats));
  } catch (error) {
    console.error('Failed to update user stats:', error);
  }
}

// JWT署名・検証のヘルパー関数
async function signJWT(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${data}.${encodedSignature}`;
}

async function verifyJWT(token, secret) {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new Error('Invalid token format');
    }

    const data = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(data)
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    const payload = JSON.parse(atob(encodedPayload));
    
    // 有効期限チェック
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }
    
    return payload;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
}
async function processApiResponse(data, userId) {
  // 必要に応じてレスポンスを加工
  // 例：ユーザーに応じた情報のフィルタリング
  
  // ログ記録
  console.log(`API request processed for user: ${userId}`);
  
  return {
    ...data,
    processedAt: new Date().toISOString(),
    // 機密情報の除去なども可能
  };
}