import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { AdapterFetchOptions } from '../types';
import { BaseAdapter } from './base';

export class HttpAdapter extends BaseAdapter {
  async fetch(options: AdapterFetchOptions): Promise<unknown> {
    const url = this.buildUrl(options.params);
    const requestConfig: AxiosRequestConfig = {
      method: 'GET',
      url,
      timeout: options.timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(this.source.headers ?? {}),
        ...(options.headers ?? {}),
      },
      params: {
        ...(this.source.queryParams ?? {}),
        ...(options.queryParams ?? {}),
        ...this.stringifyParams(options.params),
      },
      validateStatus: (status: number) => status >= 200 && status < 300,
    };

    const response = await axios.request(requestConfig);
    return response.data;
  }
}
