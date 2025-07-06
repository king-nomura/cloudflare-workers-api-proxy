// React PWA側でのAPIクライアント実装（匿名トークン対応）

import { useState, useEffect } from 'react';

// APIクライアントクラス
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async ensureToken() {
    let token = localStorage.getItem('anonymousToken');
    let tokenData = localStorage.getItem('anonymousTokenData');
    
    if (!token || !tokenData) {
      return await this.generateNewToken();
    }
    
    try {
      const data = JSON.parse(tokenData);
      
      // トークンの有効期限チェック
      if (Date.now() > data.expiresAt) {
        return await this.generateNewToken();
      }
      
      return { token, data };
    } catch (error) {
      return await this.generateNewToken();
    }
  }

  async generateNewToken() {
    try {
      const response = await fetch(`${this.baseUrl}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Token generation failed');
      }

      const data = await response.json();
      
      // LocalStorageに保存
      localStorage.setItem('anonymousToken', data.token);
      localStorage.setItem('anonymousTokenData', JSON.stringify(data));
      
      return { token: data.token, data };
    } catch (error) {
      console.error('Failed to generate token:', error);
      throw error;
    }
  }

  async request(endpoint, options = {}) {
    const { token } = await this.ensureToken();
    
    const config = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
      ...options,
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, config);
      
      if (!response.ok) {
        // トークンが無効な場合は再生成
        if (response.status === 401) {
          await this.generateNewToken();
          // 再試行
          const { token: newToken } = await this.ensureToken();
          config.headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, config);
          
          if (!retryResponse.ok) {
            const errorData = await retryResponse.json().catch(() => ({}));
            throw new ApiError(retryResponse.status, errorData.error || 'API request failed');
          }
          
          return await retryResponse.json();
        }
        
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorData.error || 'API request failed');
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(0, 'Network error');
    }
  }

  async callExternalService(data) {
    return this.request('/api/external-service', {
      method: 'POST',
      body: data,
    });
  }

  getUserInfo() {
    const tokenData = localStorage.getItem('anonymousTokenData');
    if (tokenData) {
      try {
        return JSON.parse(tokenData);
      } catch (error) {
        return null;
      }
    }
    return null;
  }
}

// カスタムエラークラス
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// React Hook for API calls（匿名トークン対応）
export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);

  // APIクライアントの初期化
  const apiClient = new ApiClient(
    process.env.REACT_APP_API_BASE_URL || 'https://your-worker.your-subdomain.workers.dev'
  );

  // トークン情報の取得
  useEffect(() => {
    const updateTokenInfo = () => {
      setTokenInfo(apiClient.getUserInfo());
    };
    
    updateTokenInfo();
    
    // LocalStorageの変更を監視
    const handleStorageChange = () => {
      updateTokenInfo();
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const callApi = async (apiFunction, ...args) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiFunction(...args);
      // トークン情報を更新
      setTokenInfo(apiClient.getUserInfo());
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    tokenInfo,
    callApi,
    apiClient,
  };
}

// 使用例：データ取得コンポーネント
export function DataFetcher() {
  const { loading, error, tokenInfo, callApi, apiClient } = useApi();
  const [data, setData] = useState(null);

  const fetchData = async () => {
    try {
      const result = await callApi(
        apiClient.callExternalService.bind(apiClient),
        { query: 'sample data', filters: { category: 'example' } }
      );
      setData(result);
    } catch (err) {
      console.error('Data fetch failed:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h2>Fetched Data</h2>
      {tokenInfo && (
        <div className="token-info">
          <p>User ID: {tokenInfo.userId}</p>
          <p>Requests Left: {tokenInfo.rateLimit.maxRequests - (tokenInfo.requestsUsed || 0)}</p>
          <p>Token Expires: {new Date(tokenInfo.expiresAt).toLocaleDateString()}</p>
        </div>
      )}
      {data ? (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <div>No data</div>
      )}
      <button onClick={fetchData}>Refresh</button>
    </div>
  );
}

// トークン情報表示コンポーネント
export function TokenStatus() {
  const { tokenInfo, apiClient } = useApi();
  const [refreshing, setRefreshing] = useState(false);

  const refreshToken = async () => {
    setRefreshing(true);
    try {
      await apiClient.generateNewToken();
      window.location.reload(); // 簡単な更新方法
    } catch (error) {
      console.error('Token refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  if (!tokenInfo) return <div>Loading token info...</div>;

  return (
    <div className="token-status">
      <h3>Anonymous User Status</h3>
      <p><strong>User ID:</strong> {tokenInfo.userId}</p>
      <p><strong>Token Expires:</strong> {new Date(tokenInfo.expiresAt).toLocaleString()}</p>
      <p><strong>Rate Limit:</strong> {tokenInfo.rateLimit.maxRequests} requests per hour</p>
      <button onClick={refreshToken} disabled={refreshing}>
        {refreshing ? 'Refreshing...' : 'Refresh Token'}
      </button>
    </div>
  );
}

// エラーハンドリング付きのAPIフック
export function useExternalData(query) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const { apiClient } = useApi();

  const fetchData = async () => {
    if (!query) return;

    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.callExternalService({ query });
      setData(result);
      setRetryCount(0);
    } catch (err) {
      setError(err);
      
      // レート制限の場合は自動リトライ
      if (err.status === 429 && retryCount < 3) {
        const retryAfter = err.retryAfter || 60;
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          fetchData();
        }, retryAfter * 1000);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [query]);

  return { data, loading, error, refetch: fetchData };
}

// 匿名ユーザー管理（認証システムは不要）
export function useAnonymousUser() {
  const { tokenInfo, apiClient } = useApi();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // 初回アクセス時のトークン生成
    const initializeUser = async () => {
      try {
        await apiClient.ensureToken();
        setIsInitialized(true);
      } catch (error) {
        console.error('User initialization failed:', error);
      }
    };

    initializeUser();
  }, []);

  const clearUserData = () => {
    localStorage.removeItem('anonymousToken');
    localStorage.removeItem('anonymousTokenData');
    window.location.reload();
  };

  return { 
    tokenInfo, 
    isInitialized, 
    clearUserData,
    userId: tokenInfo?.userId
  };
}

// メインアプリコンポーネントの例
export function App() {
  const { isInitialized, tokenInfo } = useAnonymousUser();

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <h2>Initializing...</h2>
        <p>Setting up your anonymous session...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>My PWA</h1>
        <TokenStatus />
      </header>
      
      <main>
        <DataFetcher />
      </main>
    </div>
  );
}