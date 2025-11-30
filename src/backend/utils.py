import pandas as pd 
import numpy as np
from datetime import timedelta


def process_solar_data(df: pd.DataFrame) -> pd.DataFrame:
    """" does three main jobs:
     1. cleans data - handles outliers, changes column names to standard format
     2. calculates and addes impact_time column
     3. adds lag features for ml model training"""
    
    df = clean_solar_data(df)
    df = add_impact_time(df) 
    df = add_lag_features(df)
    
    return df

def clean_solar_data(df: pd.DataFrame) -> pd.DataFrame:
    """ Cleans solar data by handling outliers and renaming columns """
    
    # Rename columns to standard format
    rename_map = {
        'speed': 'Flow_Speed',
        'density': 'Proton_Density',
        'bz_gsm': 'Bz',
        'bt': 'Scalar_B'
    }
    df = df.rename(columns=rename_map)

    # Handle outliers
    cols = ['Flow_Speed', 'Proton_Density', 'Bz', 'Scalar_B']
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    df = df.replace([999.9, 9999, 99.9], np.nan) # the dataset commonly has these values where data record wa not possible. These are outliers and need to be removes
    df = df.interpolate(method='linear', limit_direction='both')

    # handling time columns
    if 'time_tag' in df.columns:
        df['observed_time'] = pd.to_datetime(df['time_tag'])
        df = df.set_index('observed_time')

    df = df.drop(columns=['time_tag'], errors='ignore')

    # converting 1 min data to 5 min data by resampling
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df = df[numeric_cols].resample('5min').mean()
    print(f"Resampled to 5min data. Rows now: {len(df)}")

    # F10.7 Handling
    if 'F10_7' not in df.columns:
        df['F10_7'] = 150.0  # default value if not present

    df = df.dropna()
    
    return df

def add_impact_time(df: pd.DataFrame) -> pd.DataFrame:
    """ calculates the impact time of the solar wind"""

    distance_km  = 1_500_000
    df["Safe_Speed"] = df["Flow_Speed"].replace(0, np.nan) #to avoid division by zero

    df["Delay"] = distance_km / df["Safe_Speed"]
    df["Impact_Time"] = df.index + pd.to_timedelta(df["Delay"], unit='s')

    df = df.drop(columns=["Safe_Speed", "Delay"])

    return df

def add_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    """ adds lag features: 
         Bz_lag1, Bz_lag3, Bz_lag6 
         Scalar_B_lag1, Scalar_B_lag3, Scalar_B_lag6
         Flow_Speed_lag1, Flow_Speed_lag3, Flow_Speed_lag6
         Proton_Density_lag1, Proton_Density_lag3, Proton_Density_lag6
         kp_lag1, kp_lag3, kp_lag6 (placeholders)
 
         Speed_Mean_6h, Bz_Mean_6h,
         Dynamic_Pressure
       needed by ml model for prediction"""
    
    # Safety Check: Need 6h history (72 rows)
    if len(df) < 72:
        print("⚠️ Not enough data to create lag features. Sending data without lag features.")
        return df  # Not enough data to create lag features
    
    # calculating 1h 3h, 6h lag features
    target_cols = ['Bz', 'Flow_Speed', 'Proton_Density']
    for col in target_cols:
        if col in df.columns:
            df[f'{col}_lag1'] = df[col].shift(12)
            df[f'{col}_lag3'] = df[col].shift(36)
            df[f'{col}_lag6'] = df[col].shift(72)

    # calculating 6h mean features
    df['Speed_Mean_6h'] = df['Flow_Speed'].rolling(window = 72).mean()
    df['Bz_Mean_6h'] = df['Bz'].rolling(window = 72).mean()

    # calculating Dynamic Pressure
    df["Dynamic_Pressure"] = df["Proton_Density"] * (df["Flow_Speed"] ** 2)

    # Placeholder Kp Lags (Needed to prevent model crash)
    df['Kp_lag1'] = 3.0
    df['Kp_lag3'] = 3.0
    df['Kp_lag6'] = 3.0 

    return df