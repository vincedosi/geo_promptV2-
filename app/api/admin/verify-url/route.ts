import { NextRequest, NextResponse } from 'next/server';

/**
 * API pour vérifier si une URL est accessible
 * POST /api/admin/verify-url
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json(
        { error: 'URL manquante' },
        { status: 400 }
      );
    }
    
    // Vérifier le format de l'URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { 
          valid: false, 
          error: 'URL invalide - format incorrect' 
        },
        { status: 200 }
      );
    }
    
    // Vérifier que l'URL pointe vers un fichier (extension .zip ou .csv)
    const validExtensions = ['.zip', '.csv', '.xlsx', '.xls'];
    const hasValidExtension = validExtensions.some(ext => 
      parsedUrl.pathname.toLowerCase().endsWith(ext)
    );
    
    if (!hasValidExtension) {
      return NextResponse.json(
        { 
          valid: false, 
          error: 'URL doit pointer vers un fichier .zip, .csv, .xlsx ou .xls',
          warning: true
        },
        { status: 200 }
      );
    }
    
    // Faire une requête HEAD pour vérifier l'accessibilité
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'GENESIS-ETL/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return NextResponse.json(
          { 
            valid: false, 
            error: `Erreur HTTP ${response.status} - ${response.statusText}`,
            statusCode: response.status
          },
          { status: 200 }
        );
      }
      
      // Récupérer les informations sur le fichier
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');
      const lastModified = response.headers.get('last-modified');
      
      return NextResponse.json({
        valid: true,
        url: url,
        fileSize: contentLength ? parseInt(contentLength) : null,
        fileSizeMB: contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) : null,
        contentType: contentType,
        lastModified: lastModified,
        message: '✅ URL accessible'
      });
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return NextResponse.json(
          { 
            valid: false, 
            error: 'Timeout - Le serveur ne répond pas (>10s)' 
          },
          { status: 200 }
        );
      }
      
      return NextResponse.json(
        { 
          valid: false, 
          error: `Erreur réseau : ${error.message}` 
        },
        { status: 200 }
      );
    }
    
  } catch (error: any) {
    console.error('Erreur verify-url:', error);
    return NextResponse.json(
      { error: 'Erreur serveur', details: error.message },
      { status: 500 }
    );
  }
}
